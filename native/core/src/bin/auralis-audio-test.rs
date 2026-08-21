use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use auralis_core::{
    audio::{
        DEFAULT_CAPTURE_QUEUE_CAPACITY, DEFAULT_CHUNK_SECONDS,
        format::NativeAudioFormat,
        handoff::{CaptureQueueStats, bounded_capture_queue},
        lifecycle::{DeviceLifecycleCoordinator, DeviceLifecycleEvent, LifecycleSnapshot},
        persistence::{CapturePersistenceWorker, PersistenceCursor},
        recovery::{RecoveryManager, RecoveryReport},
        spool::FileRawSpool,
        wasapi::{
            CaptureGroupDescriptor, CaptureMode, CaptureStartCursor, WasapiCaptureDescriptor,
            WasapiCaptureGroup,
        },
        windows_lifecycle::{WindowsLifecycleMonitor, WindowsLifecycleSignal},
    },
    domain::{
        audio_frame::{ChannelId, SampleFormat, SessionId},
        ledger::{AudioChannel, CaptureState, DeviceState, RecoveryState, Session, SourceKind},
        ports::{CoreError, SpoolContract},
    },
    storage::LedgerRepository,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use windows::{
    Win32::Storage::FileSystem::{MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW},
    core::PCWSTR,
};

const STATE_FILE: &str = "session-state.json";
const SUMMARY_FILE: &str = "capture-summary.json";
const LEDGER_FILE: &str = "audio-ledger.sqlite";
const LOG_FILE: &str = "logs/capture.log";
const SPOOL_DIRECTORY: &str = "spool";
const PRODUCT_EVENT_JOURNAL_FILE: &str = "product-events.jsonl";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum TestMode {
    Mic,
    Loopback,
    Both,
}

impl TestMode {
    fn capture_mode(self) -> CaptureMode {
        match self {
            Self::Mic => CaptureMode::MicrophoneOnly,
            Self::Loopback => CaptureMode::SystemLoopbackOnly,
            Self::Both => CaptureMode::MicrophoneAndSystem,
        }
    }
}

#[derive(Debug)]
struct Arguments {
    mode: TestMode,
    duration: Duration,
    output: PathBuf,
    chunk_seconds: u32,
    resume: bool,
    stop_file: Option<PathBuf>,
    event_protocol: Option<EventProtocol>,
    event_session_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EventProtocol {
    JsonLinesV1,
}

#[derive(Clone)]
struct ProductEventSink {
    session_id: String,
    journal: Arc<Mutex<fs::File>>,
}

impl ProductEventSink {
    fn open(session_id: String, output: &Path) -> Result<Self, String> {
        let journal_path = output.join(PRODUCT_EVENT_JOURNAL_FILE);
        let journal = OpenOptions::new()
            .append(true)
            .create(true)
            .open(&journal_path)
            .map_err(io_error)?;
        journal.sync_all().map_err(io_error)?;
        Ok(Self {
            session_id,
            journal: Arc::new(Mutex::new(journal)),
        })
    }

    fn emit(&self, event_type: &str, channel_id: Option<&str>, payload: Value) {
        let line = json!({
            "protocol": "auralis.native/jsonl-v1",
            "type": event_type,
            "session_id": self.session_id,
            "channel_id": channel_id,
            "occurred_at": utc_now(),
            "payload": payload,
        });
        let Ok(serialized) = serde_json::to_string(&line) else {
            return;
        };
        if event_type != "probe.heartbeat" {
            let journal_result = self
                .journal
                .lock()
                .map_err(|_| "product event journal lock is poisoned".to_string())
                .and_then(|mut journal| {
                    writeln!(journal, "{serialized}").map_err(io_error)?;
                    journal.flush().map_err(io_error)?;
                    journal.sync_data().map_err(io_error)
                });
            if let Err(error) = journal_result {
                eprintln!("AURALIS_PRODUCT_EVENT_JOURNAL_ERROR: {error}");
                return;
            }
        }
        let stdout = std::io::stdout();
        let mut locked = stdout.lock();
        let _ = writeln!(locked, "{serialized}");
        let _ = locked.flush();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingGap {
    channel_id: String,
    gap_id: String,
    sequence_start: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct RunState {
    schema_version: u32,
    session_id: String,
    mode: TestMode,
    active: bool,
    completed: bool,
    run_count: u32,
    last_stop_reason: String,
    pending_gaps: Vec<PendingGap>,
}

#[derive(Debug, Serialize)]
struct FormatSummary {
    device_id: String,
    source_kind: SourceKind,
    sample_rate_hz: u32,
    channels: u16,
    channel_mask: Option<u32>,
    sample_format: SampleFormat,
    bits_per_sample: u16,
    valid_bits_per_sample: u16,
    block_align: u16,
    endpoint_buffer_frames: u32,
}

#[derive(Debug, Serialize)]
struct EnergySummary {
    supported: bool,
    finalized_files: u64,
    raw_bytes: u64,
    decoded_frames: u64,
    channel_peaks: Vec<f64>,
    right_channel_only_observed: bool,
}

#[derive(Debug, Serialize)]
struct ChannelSummary {
    channel_id: String,
    format: FormatSummary,
    queue: QueueSummary,
    durable_sequence: u64,
    energy: EnergySummary,
}

#[derive(Debug, Serialize)]
struct QueueSummary {
    accepted_buffers: u64,
    accepted_samples: u64,
    dropped_buffers: u64,
    dropped_samples: u64,
    dropped_runs: u64,
}

impl From<CaptureQueueStats> for QueueSummary {
    fn from(value: CaptureQueueStats) -> Self {
        Self {
            accepted_buffers: value.accepted_buffers,
            accepted_samples: value.accepted_samples,
            dropped_buffers: value.dropped_buffers,
            dropped_samples: value.dropped_samples,
            dropped_runs: value.dropped_runs,
        }
    }
}

#[derive(Debug, Serialize)]
struct CaptureSummary {
    result: String,
    validation_class: String,
    session_id: String,
    mode: TestMode,
    started_at_utc: String,
    stopped_at_utc: String,
    requested_duration_seconds: u64,
    resume_required: bool,
    stop_reason: String,
    channels: Vec<ChannelSummary>,
    ledger_counts: LedgerCounts,
    unknown_gap_count: u64,
    recovery_scan_count: u64,
    recovery_report: Option<RecoveryReportSummary>,
    lifecycle_signals_emitted: u64,
    lifecycle_signals_dropped: u64,
    artifacts: ArtifactPaths,
    hardware_pass_claimed: bool,
}

#[derive(Debug, Serialize)]
struct LedgerCounts {
    sessions: u64,
    channels: u64,
    chunks: u64,
    gaps: u64,
}

#[derive(Debug, Serialize)]
struct RecoveryReportSummary {
    recovered_chunks: u64,
    incomplete_chunks: u64,
    missing_chunks: u64,
    orphan_files: u64,
    restored_jobs: u64,
}

impl From<RecoveryReport> for RecoveryReportSummary {
    fn from(value: RecoveryReport) -> Self {
        Self {
            recovered_chunks: value.recovered_chunks,
            incomplete_chunks: value.incomplete_chunks,
            missing_chunks: value.missing_chunks,
            orphan_files: value.orphan_files,
            restored_jobs: value.restored_jobs,
        }
    }
}

#[derive(Debug, Serialize)]
struct ArtifactPaths {
    output_root: String,
    ledger: String,
    spool: String,
    log: String,
    summary: String,
    state: String,
}

struct ActiveChannel {
    id: ChannelId,
    descriptor: WasapiCaptureDescriptor,
    worker: JoinHandle<Result<u64, String>>,
}

fn main() {
    match run() {
        Ok(exit_code) => std::process::exit(exit_code),
        Err(error) => {
            eprintln!("AURALIS_AUDIO_TEST_ERROR: {error}");
            std::process::exit(1);
        }
    }
}

fn run() -> Result<i32, String> {
    let arguments = parse_arguments()?;
    let output = absolute_path(&arguments.output)?;
    fs::create_dir_all(output.join("logs")).map_err(io_error)?;
    fs::create_dir_all(output.join(SPOOL_DIRECTORY)).map_err(io_error)?;
    let event_sink = arguments
        .event_protocol
        .map(|_| {
            ProductEventSink::open(
                arguments
                    .event_session_id
                    .clone()
                    .expect("event-session-id is validated by parse_arguments"),
                &output,
            )
        })
        .transpose()?;
    let log_path = output.join(LOG_FILE);
    log_line(&log_path, "starting AUR-1401 Windows product audio bridge")?;

    let state_path = output.join(STATE_FILE);
    let ledger_path = output.join(LEDGER_FILE);
    let spool_path = output.join(SPOOL_DIRECTORY);
    let started_at = utc_now();
    if !arguments.resume && (state_path.exists() || ledger_path.exists()) {
        return Err(format!(
            "output already contains a test session; use --resume or choose another directory: {}",
            output.display()
        ));
    }
    let mut ledger = LedgerRepository::open(&ledger_path).map_err(core_error)?;
    let mut state = if arguments.resume {
        let state = read_state(&state_path)?;
        if state.completed {
            return Err("the requested session is already complete".into());
        }
        if state.mode != arguments.mode {
            return Err("--mode must match the session being resumed".into());
        }
        state
    } else {
        let session_id = new_session_id()?;
        ledger
            .create_session(&Session {
                id: session_id,
                started_at_utc: started_at.clone(),
                ended_at_utc: None,
                app_version: env!("CARGO_PKG_VERSION").into(),
                schema_version: 5,
                capture_state: CaptureState::Capturing,
                recovery_state: RecoveryState::Clean,
                config_snapshot_json: serde_json::json!({
                    "mode":arguments.mode,
                    "queue_capacity":DEFAULT_CAPTURE_QUEUE_CAPACITY,
                    "chunk_seconds":arguments.chunk_seconds,
                    "event_protocol":arguments.event_protocol.map(|_| "jsonl-v1"),
                })
                .to_string(),
            })
            .map_err(core_error)?;
        RunState {
            schema_version: 1,
            session_id: session_id.to_string(),
            mode: arguments.mode,
            active: true,
            completed: false,
            run_count: 0,
            last_stop_reason: "new-session".into(),
            pending_gaps: Vec::new(),
        }
    };
    let session_id = state
        .session_id
        .parse::<SessionId>()
        .map_err(|_| "session state contains an invalid session id".to_string())?;
    let mic_channel_id = ChannelId(format!("{}-microphone", state.session_id));
    let system_channel_id = ChannelId(format!("{}-system-loopback", state.session_id));

    let recovery_report = if arguments.resume {
        prepare_recovery(
            &mut ledger,
            &spool_path,
            &ledger_path,
            session_id,
            &mut state,
            [&mic_channel_id, &system_channel_id],
        )?
    } else {
        None
    };
    state.run_count = state.run_count.saturating_add(1);
    state.active = true;
    state.last_stop_reason = "capture-running".into();
    write_state(&state_path, &state)?;

    let mic_cursor = resume_cursor(&ledger, &mic_channel_id)?;
    let system_cursor = resume_cursor(&ledger, &system_channel_id)?;
    drop(ledger);

    let lifecycle_monitor = WindowsLifecycleMonitor::start(128).map_err(core_error)?;
    let (mic_sender, mic_receiver) =
        bounded_capture_queue(DEFAULT_CAPTURE_QUEUE_CAPACITY).map_err(core_error)?;
    let (system_sender, system_receiver) =
        bounded_capture_queue(DEFAULT_CAPTURE_QUEUE_CAPACITY).map_err(core_error)?;
    let group = WasapiCaptureGroup::new(
        mic_channel_id.clone(),
        mic_sender.clone(),
        system_channel_id.clone(),
        system_sender.clone(),
    );
    let descriptors = group
        .start_session_at(
            session_id,
            arguments.mode.capture_mode(),
            mic_cursor.0,
            system_cursor.0,
        )
        .map_err(core_error)?;

    let mut setup_ledger = LedgerRepository::open(&ledger_path).map_err(core_error)?;
    let mut active_channels = Vec::new();
    if let Some(descriptor) = descriptors.microphone.clone() {
        activate_channel(
            &mut setup_ledger,
            session_id,
            &descriptor,
            &mic_channel_id,
            mic_cursor,
            arguments.resume,
            &ledger_path,
        )?;
        active_channels.push(spawn_persistence_worker(
            ledger_path.clone(),
            spool_path.clone(),
            session_id,
            mic_channel_id.clone(),
            descriptor,
            mic_cursor,
            mic_receiver,
            arguments.chunk_seconds,
            event_sink.clone(),
        )?);
    }
    if let Some(descriptor) = descriptors.system_loopback.clone() {
        activate_channel(
            &mut setup_ledger,
            session_id,
            &descriptor,
            &system_channel_id,
            system_cursor,
            arguments.resume,
            &ledger_path,
        )?;
        active_channels.push(spawn_persistence_worker(
            ledger_path.clone(),
            spool_path.clone(),
            session_id,
            system_channel_id.clone(),
            descriptor,
            system_cursor,
            system_receiver,
            arguments.chunk_seconds,
            event_sink.clone(),
        )?);
    }
    drop(setup_ledger);

    log_line(
        &log_path,
        &format!(
            "capture started mode={:?} duration={}s",
            arguments.mode,
            arguments.duration.as_secs()
        ),
    )?;
    if let Some(events) = event_sink.as_ref() {
        for channel in &active_channels {
            emit_channel_started(events, &channel.descriptor);
        }
    } else {
        print_descriptors(&descriptors);
    }

    let deadline = Instant::now() + arguments.duration;
    let mut lifecycle_stop: Option<WindowsLifecycleSignal> = None;
    while Instant::now() < deadline
        && !arguments
            .stop_file
            .as_ref()
            .is_some_and(|path| path.exists())
    {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let wait = remaining.min(Duration::from_millis(500));
        match lifecycle_monitor.recv_timeout(wait) {
            Ok(signal) => {
                if signal_affects_active_channel(&signal, &active_channels) {
                    lifecycle_stop = Some(signal);
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err("Windows lifecycle monitor disconnected".into());
            }
        }
        if let Some(events) = event_sink.as_ref() {
            let mic = mic_sender.stats();
            let system = system_sender.stats();
            events.emit(
                "probe.heartbeat",
                None,
                json!({
                    "queue_depth": 0,
                    "queue_depth_observable": false,
                    "queue_capacity": DEFAULT_CAPTURE_QUEUE_CAPACITY,
                    "accepted_buffers": mic
                        .accepted_buffers
                        .saturating_add(system.accepted_buffers),
                    "accepted_samples": mic
                        .accepted_samples
                        .saturating_add(system.accepted_samples),
                    "dropped_buffers": mic.dropped_buffers.saturating_add(system.dropped_buffers),
                    "dropped_samples": mic.dropped_samples.saturating_add(system.dropped_samples),
                }),
            );
        }
    }

    if lifecycle_stop.is_none() {
        for channel in &active_channels {
            record_graceful_stop_requested(&ledger_path, session_id, &channel.id)?;
        }
    }
    let stop_result = group.stop_session();
    drop(group);
    let monitor_stats = lifecycle_monitor.stats();
    drop(lifecycle_monitor);
    let mic_stats = mic_sender.stats();
    let system_stats = system_sender.stats();
    drop(mic_sender);
    drop(system_sender);

    let mut channel_results = Vec::new();
    for channel in active_channels {
        let durable_sequence = channel
            .worker
            .join()
            .map_err(|_| format!("persistence worker panicked: {}", channel.id))??;
        let queue = if channel.descriptor.source_kind == SourceKind::UserMic {
            mic_stats
        } else {
            system_stats
        };
        channel_results.push((channel.id, channel.descriptor, queue, durable_sequence));
    }
    if let Some(events) = event_sink.as_ref() {
        for (_, descriptor, _, durable_sequence) in &channel_results {
            events.emit(
                "capture.channel_stopped",
                Some(product_channel_id(descriptor.source_kind)),
                json!({ "sequence": durable_sequence }),
            );
        }
    }
    if let Err(error) = stop_result {
        log_line(&log_path, &format!("capture stop returned: {error}"))?;
        if lifecycle_stop.is_none() {
            return Err(error.to_string());
        }
    }

    let stopped_at = utc_now();
    let mut final_ledger = LedgerRepository::open(&ledger_path).map_err(core_error)?;
    resolve_pending_gaps(&mut final_ledger, &mut state, &stopped_at)?;
    let resume_required = if let Some(signal) = lifecycle_stop.as_ref() {
        state.last_stop_reason = format!("windows-lifecycle:{signal:?}");
        for (channel_id, descriptor, _, _) in &channel_results {
            if let Some(event) =
                signal.to_device_event(descriptor.source_kind, &descriptor.device_id)
            {
                let pending = record_interruption(&ledger_path, session_id, channel_id, event)?;
                state.pending_gaps.push(pending);
            }
        }
        true
    } else {
        for (channel_id, _, _, _) in &channel_results {
            record_graceful_stopped(&ledger_path, session_id, channel_id)?;
        }
        final_ledger
            .complete_session(session_id, &stopped_at)
            .map_err(core_error)?;
        state.last_stop_reason = "requested-duration-complete".into();
        state.completed = true;
        false
    };
    state.active = resume_required;
    write_state(&state_path, &state)?;

    let counts = final_ledger.counts().map_err(core_error)?;
    let unknown_gap_count = final_ledger.unknown_gap_count().map_err(core_error)?;
    let recovery_scan_count = final_ledger.recovery_scan_count().map_err(core_error)?;
    let mut summaries = Vec::new();
    for (channel_id, descriptor, queue, durable_sequence) in channel_results {
        let energy = analyze_channel(&spool_path, session_id, &channel_id, descriptor.format)?;
        summaries.push(ChannelSummary {
            channel_id: channel_id.0,
            format: format_summary(&descriptor),
            queue: queue.into(),
            durable_sequence,
            energy,
        });
    }
    let summary_path = output.join(SUMMARY_FILE);
    let summary = CaptureSummary {
        result: if resume_required {
            "RESUME_REQUIRED".into()
        } else {
            "CAPTURE_COMPLETE".into()
        },
        validation_class: "REAL_WINDOWS_HARDWARE_RESULT_REQUIRES_HUMAN_REVIEW".into(),
        session_id: state.session_id.clone(),
        mode: state.mode,
        started_at_utc: started_at,
        stopped_at_utc: stopped_at,
        requested_duration_seconds: arguments.duration.as_secs(),
        resume_required,
        stop_reason: state.last_stop_reason.clone(),
        channels: summaries,
        ledger_counts: LedgerCounts {
            sessions: counts.0,
            channels: counts.1,
            chunks: counts.2,
            gaps: counts.3,
        },
        unknown_gap_count,
        recovery_scan_count,
        recovery_report: recovery_report.map(Into::into),
        lifecycle_signals_emitted: monitor_stats.emitted,
        lifecycle_signals_dropped: monitor_stats.dropped,
        artifacts: artifact_paths(&output),
        hardware_pass_claimed: false,
    };
    write_json_atomic(&summary_path, &summary)?;
    log_line(
        &log_path,
        &format!(
            "capture stopped result={} unknown_gaps={} lifecycle_dropped={}",
            summary.result, summary.unknown_gap_count, summary.lifecycle_signals_dropped
        ),
    )?;
    if let Some(events) = event_sink.as_ref() {
        events.emit(
            "capture.completed",
            None,
            json!({
                "result": summary.result,
                "summary_path": summary_path,
                "ledger_path": ledger_path,
                "spool_path": spool_path,
                "unknown_gaps": summary.unknown_gap_count,
                "lifecycle_signals_dropped": summary.lifecycle_signals_dropped,
            }),
        );
    } else {
        println!("RESULT: {}", summary.result);
        println!("SUMMARY: {}", summary_path.display());
        println!("LEDGER: {}", ledger_path.display());
        println!("SPOOL: {}", spool_path.display());
        println!("UNKNOWN_GAPS: {}", summary.unknown_gap_count);
        println!(
            "LIFECYCLE_SIGNALS_DROPPED: {}",
            summary.lifecycle_signals_dropped
        );
    }
    if resume_required {
        if event_sink.is_none() {
            println!(
                "RESUME: {} capture --mode {} --duration-seconds {} --output \"{}\" --resume",
                std::env::current_exe().map_err(io_error)?.display(),
                mode_name(arguments.mode),
                arguments.duration.as_secs(),
                output.display()
            );
        }
        Ok(20)
    } else {
        Ok(0)
    }
}

fn parse_arguments() -> Result<Arguments, String> {
    let mut arguments = std::env::args().skip(1);
    if arguments.next().as_deref() != Some("capture") {
        return Err(usage());
    }
    let mut mode = None;
    let mut duration = None;
    let mut output = None;
    let mut chunk_seconds = DEFAULT_CHUNK_SECONDS;
    let mut resume = false;
    let mut stop_file = None;
    let mut event_protocol = None;
    let mut event_session_id = None;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--mode" => {
                mode = Some(match arguments.next().as_deref() {
                    Some("mic") => TestMode::Mic,
                    Some("loopback") => TestMode::Loopback,
                    Some("both") => TestMode::Both,
                    _ => return Err("--mode must be mic, loopback, or both".into()),
                });
            }
            "--duration-seconds" => {
                let value = arguments
                    .next()
                    .ok_or_else(|| "--duration-seconds requires a value".to_string())?
                    .parse::<u64>()
                    .map_err(|_| "--duration-seconds must be an integer".to_string())?;
                if value == 0 {
                    return Err("--duration-seconds must be non-zero".into());
                }
                duration = Some(Duration::from_secs(value));
            }
            "--output" => {
                output = Some(PathBuf::from(
                    arguments
                        .next()
                        .ok_or_else(|| "--output requires a path".to_string())?,
                ));
            }
            "--chunk-seconds" => {
                let value = arguments
                    .next()
                    .ok_or_else(|| "--chunk-seconds requires a value".to_string())?
                    .parse::<u32>()
                    .map_err(|_| "--chunk-seconds must be an integer".to_string())?;
                if !(2..=10).contains(&value) {
                    return Err("--chunk-seconds must be between 2 and 10".into());
                }
                chunk_seconds = value;
            }
            "--resume" => resume = true,
            "--stop-file" => {
                stop_file = Some(PathBuf::from(
                    arguments
                        .next()
                        .ok_or_else(|| "--stop-file requires a path".to_string())?,
                ));
            }
            "--event-protocol" => {
                event_protocol = Some(match arguments.next().as_deref() {
                    Some("jsonl-v1") => EventProtocol::JsonLinesV1,
                    _ => return Err("--event-protocol must be jsonl-v1".into()),
                });
            }
            "--event-session-id" => {
                let value = arguments
                    .next()
                    .ok_or_else(|| "--event-session-id requires a value".to_string())?;
                if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
                    return Err("--event-session-id is invalid".into());
                }
                event_session_id = Some(value);
            }
            _ => return Err(format!("unknown argument: {argument}\n{}", usage())),
        }
    }
    if event_protocol.is_some() != event_session_id.is_some() {
        return Err("--event-protocol and --event-session-id must be supplied together".into());
    }
    Ok(Arguments {
        mode: mode.ok_or_else(usage)?,
        duration: duration.ok_or_else(usage)?,
        output: output.ok_or_else(usage)?,
        chunk_seconds,
        resume,
        stop_file,
        event_protocol,
        event_session_id,
    })
}

fn usage() -> String {
    concat!(
        "usage: auralis-audio-test capture --mode mic|loopback|both ",
        "--duration-seconds N --output PATH [--chunk-seconds 2..10] ",
        "[--resume] [--stop-file PATH] ",
        "[--event-protocol jsonl-v1 --event-session-id ID]"
    )
    .into()
}

type ResumeCursor = (CaptureStartCursor, Option<u64>);

fn resume_cursor(
    ledger: &LedgerRepository,
    channel_id: &ChannelId,
) -> Result<ResumeCursor, String> {
    let value = ledger
        .channel_resume_cursor(&channel_id.0)
        .map_err(core_error)?;
    Ok(match value {
        Some((sequence, qpc, device_position)) => (
            CaptureStartCursor {
                next_sequence: sequence,
                last_qpc_end_100ns: qpc,
            },
            device_position,
        ),
        None => (CaptureStartCursor::default(), None),
    })
}

#[allow(clippy::too_many_arguments)]
fn activate_channel(
    ledger: &mut LedgerRepository,
    session_id: SessionId,
    descriptor: &WasapiCaptureDescriptor,
    channel_id: &ChannelId,
    cursor: ResumeCursor,
    resumed: bool,
    ledger_path: &Path,
) -> Result<(), String> {
    let existing = ledger
        .channel_lifecycle_state(&channel_id.0)
        .map_err(core_error)?;
    let snapshot =
        existing.map(
            |(capture_state, device_state, recovery_state)| LifecycleSnapshot {
                capture_state,
                device_state,
                recovery_state,
            },
        );
    let registration_state = snapshot.unwrap_or(LifecycleSnapshot {
        capture_state: CaptureState::Capturing,
        device_state: DeviceState::Available,
        recovery_state: RecoveryState::Clean,
    });
    ledger
        .register_channel(&AudioChannel {
            id: channel_id.clone(),
            session_id,
            source_kind: descriptor.source_kind,
            device_id: Some(descriptor.device_id.clone()),
            device_generation: if resumed { 2 } else { 1 },
            native_sample_rate: descriptor.format.sample_rate_hz,
            native_channels: descriptor.format.channels,
            channel_mask: descriptor.format.channel_mask,
            sample_format: descriptor.format.sample_format,
            bits_per_sample: descriptor.format.bits_per_sample,
            valid_bits_per_sample: descriptor.format.valid_bits_per_sample,
            block_align: descriptor.format.block_align,
            capture_state: registration_state.capture_state,
            device_state: registration_state.device_state,
            recovery_state: registration_state.recovery_state,
            last_sequence: cursor.0.next_sequence,
            last_qpc_100ns: cursor.0.last_qpc_end_100ns,
            last_device_position: cursor.1,
        })
        .map_err(core_error)?;
    if let Some(snapshot) = snapshot {
        let owned = LedgerRepository::open(ledger_path).map_err(core_error)?;
        let mut coordinator = DeviceLifecycleCoordinator::new(
            owned,
            session_id,
            channel_id.clone(),
            snapshot,
            Arc::new(utc_now),
        );
        if matches!(
            snapshot.device_state,
            DeviceState::Unknown | DeviceState::Disconnected | DeviceState::Invalidated
        ) {
            coordinator
                .handle(
                    DeviceLifecycleEvent::ReconnectDetected {
                        device_id: descriptor.device_id.clone(),
                    },
                    cursor.0.next_sequence,
                    cursor.0.last_qpc_end_100ns,
                )
                .map_err(core_error)?;
        } else if snapshot.device_state == DeviceState::Suspended {
            coordinator
                .handle(
                    DeviceLifecycleEvent::Resume,
                    cursor.0.next_sequence,
                    cursor.0.last_qpc_end_100ns,
                )
                .map_err(core_error)?;
        }
        coordinator
            .handle(
                DeviceLifecycleEvent::CaptureRestarted {
                    device_id: descriptor.device_id.clone(),
                },
                cursor.0.next_sequence,
                cursor.0.last_qpc_end_100ns,
            )
            .map_err(core_error)?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn spawn_persistence_worker(
    ledger_path: PathBuf,
    spool_path: PathBuf,
    session_id: SessionId,
    channel_id: ChannelId,
    descriptor: WasapiCaptureDescriptor,
    cursor: ResumeCursor,
    receiver: auralis_core::audio::handoff::CaptureQueueReceiver,
    chunk_seconds: u32,
    event_sink: Option<ProductEventSink>,
) -> Result<ActiveChannel, String> {
    let worker_channel = channel_id.clone();
    let worker_format = descriptor.format;
    let worker_source_kind = descriptor.source_kind;
    let worker = thread::Builder::new()
        .name(format!(
            "auralis-persist-{}",
            descriptor.source_kind.as_storage_str()
        ))
        .spawn(move || {
            let ledger = LedgerRepository::open(&ledger_path).map_err(|error| error.to_string())?;
            let event_spool_root = spool_path.clone();
            let spool = FileRawSpool::new(
                SpoolContract {
                    root: spool_path,
                    chunk_frames: u64::from(worker_format.sample_rate_hz)
                        * u64::from(chunk_seconds),
                    sync_on_finalize: true,
                },
                Arc::new(utc_now),
            )
            .map_err(|error| error.to_string())?;
            let persistence = CapturePersistenceWorker::new(
                receiver,
                ledger,
                spool,
                PersistenceCursor {
                    session_id,
                    channel_id: worker_channel,
                    initial_sequence: cursor.0.next_sequence,
                    initial_device_position: cursor.1,
                },
                Arc::new(utc_now),
            );
            let mut persistence = if let Some(events) = event_sink {
                let channel = product_channel_id(worker_source_kind).to_string();
                persistence.with_chunk_commit_observer(Arc::new(move |chunk| {
                    events.emit(
                        "audio.chunk_closed",
                        Some(&channel),
                        json!({
                            "chunk_id": chunk.id,
                            "path": event_spool_root.join(&chunk.path),
                            "seq_start": chunk.seq_start,
                            "seq_end": chunk.seq_end,
                            "qpc_start_100ns": chunk.qpc_start_100ns,
                            "qpc_end_100ns": chunk.qpc_end_100ns,
                            "sample_rate": chunk.sample_rate,
                            "channels": chunk.channels,
                            "channel_mask": chunk.channel_mask,
                            "sample_format": chunk.sample_format.as_storage_value(),
                            "format_tag": wave_format_tag(chunk.sample_format),
                            "bits_per_sample": chunk.bits_per_sample,
                            "valid_bits_per_sample": chunk.valid_bits_per_sample,
                            "block_align": chunk.block_align,
                            "byte_length": chunk.byte_length,
                            "sha256": chunk.sha256_hex,
                            "discontinuity": chunk
                                .discontinuity
                                .map(|reason| reason.as_storage_str()),
                        }),
                    );
                }))
            } else {
                persistence
            };
            persistence
                .run_until_disconnected()
                .map_err(|error| error.to_string())?;
            Ok(persistence.expected_sequence())
        })
        .map_err(|error| format!("failed to spawn persistence worker: {error}"))?;
    Ok(ActiveChannel {
        id: channel_id,
        descriptor,
        worker,
    })
}

fn prepare_recovery(
    ledger: &mut LedgerRepository,
    spool_path: &Path,
    ledger_path: &Path,
    session_id: SessionId,
    state: &mut RunState,
    channels: [&ChannelId; 2],
) -> Result<Option<RecoveryReport>, String> {
    for channel_id in channels {
        let Some(_) = ledger
            .channel_lifecycle_state(&channel_id.0)
            .map_err(core_error)?
        else {
            continue;
        };
        let already_pending = state
            .pending_gaps
            .iter()
            .any(|pending| pending.channel_id == channel_id.0);
        if !already_pending {
            let sequence = ledger
                .channel_last_sequence(&channel_id.0)
                .map_err(core_error)?
                .unwrap_or(0);
            let pending = record_interruption(
                ledger_path,
                session_id,
                channel_id,
                DeviceLifecycleEvent::RestartDetected,
            )?;
            state.pending_gaps.push(PendingGap {
                sequence_start: sequence,
                ..pending
            });
        }
        record_recovery_started(ledger_path, session_id, channel_id)?;
    }
    let report = RecoveryManager::new(spool_path, ledger, Arc::new(utc_now))
        .map_err(core_error)?
        .scan_session(session_id)
        .map_err(core_error)?;
    for channel_id in channels {
        if ledger
            .channel_lifecycle_state(&channel_id.0)
            .map_err(core_error)?
            .is_some()
        {
            record_recovery_completed(
                ledger_path,
                session_id,
                channel_id,
                report.incomplete_chunks + report.orphan_files,
            )?;
        }
    }
    Ok(Some(report))
}

fn record_recovery_started(
    ledger_path: &Path,
    session_id: SessionId,
    channel_id: &ChannelId,
) -> Result<(), String> {
    let ledger = LedgerRepository::open(ledger_path).map_err(core_error)?;
    let snapshot = lifecycle_snapshot(&ledger, channel_id)?;
    let mut coordinator = DeviceLifecycleCoordinator::new(
        ledger,
        session_id,
        channel_id.clone(),
        snapshot,
        Arc::new(utc_now),
    );
    coordinator
        .handle(DeviceLifecycleEvent::RecoveryScanStarted, 0, None)
        .map_err(core_error)?;
    Ok(())
}

fn record_recovery_completed(
    ledger_path: &Path,
    session_id: SessionId,
    channel_id: &ChannelId,
    incomplete_chunks: u64,
) -> Result<(), String> {
    let ledger = LedgerRepository::open(ledger_path).map_err(core_error)?;
    let snapshot = lifecycle_snapshot(&ledger, channel_id)?;
    let mut coordinator = DeviceLifecycleCoordinator::new(
        ledger,
        session_id,
        channel_id.clone(),
        snapshot,
        Arc::new(utc_now),
    );
    coordinator
        .handle(
            DeviceLifecycleEvent::RecoveryScanCompleted { incomplete_chunks },
            0,
            None,
        )
        .map_err(core_error)?;
    Ok(())
}

fn record_interruption(
    ledger_path: &Path,
    session_id: SessionId,
    channel_id: &ChannelId,
    event: DeviceLifecycleEvent,
) -> Result<PendingGap, String> {
    let ledger = LedgerRepository::open(ledger_path).map_err(core_error)?;
    let cursor = ledger
        .channel_resume_cursor(&channel_id.0)
        .map_err(core_error)?
        .ok_or_else(|| format!("channel is missing: {channel_id}"))?;
    let snapshot = lifecycle_snapshot(&ledger, channel_id)?;
    let mut coordinator = DeviceLifecycleCoordinator::new(
        ledger,
        session_id,
        channel_id.clone(),
        snapshot,
        Arc::new(utc_now),
    );
    coordinator
        .handle(event, cursor.0, cursor.1)
        .map_err(core_error)?;
    let gap_id = coordinator
        .last_gap_id()
        .ok_or_else(|| "lifecycle interruption did not create a Gap".to_string())?
        .to_string();
    Ok(PendingGap {
        channel_id: channel_id.0.clone(),
        gap_id,
        sequence_start: cursor.0,
    })
}

fn record_graceful_stop_requested(
    ledger_path: &Path,
    session_id: SessionId,
    channel_id: &ChannelId,
) -> Result<(), String> {
    record_lifecycle_only(
        ledger_path,
        session_id,
        channel_id,
        DeviceLifecycleEvent::CaptureStopRequested,
    )
}

fn record_graceful_stopped(
    ledger_path: &Path,
    session_id: SessionId,
    channel_id: &ChannelId,
) -> Result<(), String> {
    record_lifecycle_only(
        ledger_path,
        session_id,
        channel_id,
        DeviceLifecycleEvent::CaptureStopped,
    )
}

fn record_lifecycle_only(
    ledger_path: &Path,
    session_id: SessionId,
    channel_id: &ChannelId,
    event: DeviceLifecycleEvent,
) -> Result<(), String> {
    let ledger = LedgerRepository::open(ledger_path).map_err(core_error)?;
    let snapshot = lifecycle_snapshot(&ledger, channel_id)?;
    let mut coordinator = DeviceLifecycleCoordinator::new(
        ledger,
        session_id,
        channel_id.clone(),
        snapshot,
        Arc::new(utc_now),
    );
    coordinator.handle(event, 0, None).map_err(core_error)?;
    Ok(())
}

fn lifecycle_snapshot(
    ledger: &LedgerRepository,
    channel_id: &ChannelId,
) -> Result<LifecycleSnapshot, String> {
    ledger
        .channel_lifecycle_state(&channel_id.0)
        .map_err(core_error)?
        .map(
            |(capture_state, device_state, recovery_state)| LifecycleSnapshot {
                capture_state,
                device_state,
                recovery_state,
            },
        )
        .ok_or_else(|| format!("channel lifecycle state is missing: {channel_id}"))
}

fn resolve_pending_gaps(
    ledger: &mut LedgerRepository,
    state: &mut RunState,
    resolved_at_utc: &str,
) -> Result<(), String> {
    let mut unresolved = Vec::new();
    for pending in state.pending_gaps.drain(..) {
        let resumed_start = ledger
            .first_chunk_start_after(&pending.channel_id, pending.sequence_start)
            .map_err(core_error)?;
        if let Some(resumed_start) = resumed_start {
            ledger
                .resolve_gap_extent(&pending.gap_id, resumed_start, resolved_at_utc)
                .map_err(core_error)?;
        } else {
            unresolved.push(pending);
        }
    }
    state.pending_gaps = unresolved;
    Ok(())
}

fn signal_affects_active_channel(
    signal: &WindowsLifecycleSignal,
    channels: &[ActiveChannel],
) -> bool {
    channels.iter().any(|channel| {
        signal
            .to_device_event(
                channel.descriptor.source_kind,
                &channel.descriptor.device_id,
            )
            .is_some()
    })
}

fn product_channel_id(source_kind: SourceKind) -> &'static str {
    match source_kind {
        SourceKind::UserMic => "user-mic",
        SourceKind::SystemLoopback => "system-loopback",
        SourceKind::ProcessLoopback => "process-loopback",
    }
}

fn wave_format_tag(sample_format: SampleFormat) -> u16 {
    match sample_format {
        SampleFormat::PcmU8
        | SampleFormat::PcmI16
        | SampleFormat::PcmI24
        | SampleFormat::PcmI32 => 1,
        SampleFormat::Float32 => 3,
        SampleFormat::Extensible => 0xfffe,
        SampleFormat::Unknown(tag) => tag,
    }
}

fn emit_channel_started(events: &ProductEventSink, descriptor: &WasapiCaptureDescriptor) {
    events.emit(
        "capture.channel_started",
        Some(product_channel_id(descriptor.source_kind)),
        json!({
            "source_kind": descriptor.source_kind.as_storage_str(),
            "device_id": descriptor.device_id,
            "sample_rate": descriptor.format.sample_rate_hz,
            "channels": descriptor.format.channels,
            "channel_mask": descriptor.format.channel_mask,
            "sample_format": descriptor.format.sample_format.as_storage_value(),
            "format_tag": wave_format_tag(descriptor.format.sample_format),
            "bits_per_sample": descriptor.format.bits_per_sample,
            "valid_bits_per_sample": descriptor.format.valid_bits_per_sample,
            "block_align": descriptor.format.block_align,
            "endpoint_buffer_frames": descriptor.endpoint_buffer_frames,
        }),
    );
}

fn format_summary(descriptor: &WasapiCaptureDescriptor) -> FormatSummary {
    FormatSummary {
        device_id: descriptor.device_id.clone(),
        source_kind: descriptor.source_kind,
        sample_rate_hz: descriptor.format.sample_rate_hz,
        channels: descriptor.format.channels,
        channel_mask: descriptor.format.channel_mask,
        sample_format: descriptor.format.sample_format,
        bits_per_sample: descriptor.format.bits_per_sample,
        valid_bits_per_sample: descriptor.format.valid_bits_per_sample,
        block_align: descriptor.format.block_align,
        endpoint_buffer_frames: descriptor.endpoint_buffer_frames,
    }
}

fn analyze_channel(
    spool_root: &Path,
    session_id: SessionId,
    channel_id: &ChannelId,
    format: NativeAudioFormat,
) -> Result<EnergySummary, String> {
    let directory = spool_root.join(session_id.to_string()).join(format!(
        "channel-{}",
        hex_component(channel_id.0.as_bytes())
    ));
    let mut files = Vec::new();
    if directory.exists() {
        for entry in fs::read_dir(&directory).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let path = entry.path();
            if path.is_file() && path.to_string_lossy().ends_with(".raw") {
                files.push(path);
            }
        }
    }
    files.sort();
    let bytes_per_sample = usize::from(format.bits_per_sample).div_ceil(8);
    let supported = matches!(
        format.sample_format,
        SampleFormat::PcmU8
            | SampleFormat::PcmI16
            | SampleFormat::PcmI24
            | SampleFormat::PcmI32
            | SampleFormat::Float32
    );
    let mut peaks = vec![0_f64; usize::from(format.channels)];
    let mut raw_bytes = 0_u64;
    let mut decoded_frames = 0_u64;
    for path in &files {
        let mut bytes = Vec::new();
        fs::File::open(path)
            .map_err(io_error)?
            .read_to_end(&mut bytes)
            .map_err(io_error)?;
        raw_bytes = raw_bytes.saturating_add(bytes.len() as u64);
        for frame in bytes.chunks_exact(usize::from(format.block_align)) {
            decoded_frames = decoded_frames.saturating_add(1);
            if !supported {
                continue;
            }
            for (channel, peak) in peaks.iter_mut().enumerate() {
                let offset = channel * bytes_per_sample;
                let sample = decode_sample(
                    &frame[offset..offset + bytes_per_sample],
                    format.sample_format,
                );
                *peak = peak.max(sample.abs());
            }
        }
    }
    let right_channel_only_observed = if format.channel_mask == Some(2) && format.channels == 1 {
        peaks.first().is_some_and(|peak| *peak > 0.01)
    } else if peaks.len() >= 2 {
        peaks[0] < 0.01 && peaks[1] > 0.01
    } else {
        false
    };
    Ok(EnergySummary {
        supported,
        finalized_files: files.len() as u64,
        raw_bytes,
        decoded_frames,
        channel_peaks: peaks,
        right_channel_only_observed,
    })
}

fn decode_sample(bytes: &[u8], format: SampleFormat) -> f64 {
    match format {
        SampleFormat::PcmU8 => (f64::from(bytes[0]) - 128.0) / 128.0,
        SampleFormat::PcmI16 => f64::from(i16::from_le_bytes([bytes[0], bytes[1]])) / 32_768.0,
        SampleFormat::PcmI24 => {
            let value = i32::from_le_bytes([
                bytes[0],
                bytes[1],
                bytes[2],
                if bytes[2] & 0x80 == 0 { 0 } else { 0xff },
            ]);
            f64::from(value) / 8_388_608.0
        }
        SampleFormat::PcmI32 => {
            f64::from(i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
                / 2_147_483_648.0
        }
        SampleFormat::Float32 => {
            let value = f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
            if value.is_finite() {
                f64::from(value)
            } else {
                0.0
            }
        }
        _ => 0.0,
    }
}

fn print_descriptors(descriptors: &CaptureGroupDescriptor) {
    if let Some(descriptor) = &descriptors.microphone {
        println!("MIC_DEVICE: {}", descriptor.device_id);
        println!("MIC_FORMAT: {:?}", descriptor.format);
    }
    if let Some(descriptor) = &descriptors.system_loopback {
        println!("LOOPBACK_DEVICE: {}", descriptor.device_id);
        println!("LOOPBACK_FORMAT: {:?}", descriptor.format);
    }
}

fn artifact_paths(output: &Path) -> ArtifactPaths {
    ArtifactPaths {
        output_root: output.display().to_string(),
        ledger: output.join(LEDGER_FILE).display().to_string(),
        spool: output.join(SPOOL_DIRECTORY).display().to_string(),
        log: output.join(LOG_FILE).display().to_string(),
        summary: output.join(SUMMARY_FILE).display().to_string(),
        state: output.join(STATE_FILE).display().to_string(),
    }
}

fn read_state(path: &Path) -> Result<RunState, String> {
    let bytes = fs::read(path).map_err(io_error)?;
    serde_json::from_slice(&bytes).map_err(|error| format!("invalid session state: {error}"))
}

fn write_state(path: &Path, state: &RunState) -> Result<(), String> {
    write_json_atomic(path, state)
}

fn write_json_atomic(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let partial = PathBuf::from(format!(
        "{}.partial-{}-{suffix}",
        path.display(),
        std::process::id()
    ));
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial)
            .map_err(io_error)?;
        file.write_all(&bytes).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
    }
    let source = wide_path(&partial);
    let destination = wide_path(path);
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(destination.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| error.to_string())
}

fn wide_path(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

fn log_line(path: &Path, message: &str) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(io_error)?;
    writeln!(file, "{} {message}", utc_now()).map_err(io_error)
}

fn utc_now() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

fn new_session_id() -> Result<SessionId, String> {
    let value = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    Ok(SessionId(value.max(1)))
}

fn absolute_path(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        std::env::current_dir()
            .map_err(io_error)
            .map(|current| current.join(path))
    }
}

fn mode_name(mode: TestMode) -> &'static str {
    match mode {
        TestMode::Mic => "mic",
        TestMode::Loopback => "loopback",
        TestMode::Both => "both",
    }
}

fn hex_component(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn core_error(error: CoreError) -> String {
    error.to_string()
}

fn io_error(error: std::io::Error) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_decoder_preserves_signed_and_float_amplitude() {
        assert!((decode_sample(&[0xff, 0x7f], SampleFormat::PcmI16) - 0.999_969).abs() < 0.000_01);
        assert!(
            (decode_sample(&[0x00, 0x00, 0x80, 0xbf], SampleFormat::Float32) + 1.0).abs()
                < f64::EPSILON
        );
        assert!(decode_sample(&[0x00, 0x00, 0x80], SampleFormat::PcmI24) < -0.99);
    }

    #[test]
    fn mode_names_match_hardware_commands() {
        assert_eq!(mode_name(TestMode::Mic), "mic");
        assert_eq!(mode_name(TestMode::Loopback), "loopback");
        assert_eq!(mode_name(TestMode::Both), "both");
    }
}
