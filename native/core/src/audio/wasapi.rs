use std::{
    ffi::c_void,
    ptr::{self, NonNull},
    slice,
    sync::{Arc, Mutex, mpsc},
    thread::{self, JoinHandle},
    time::Duration,
};

use windows::{
    Win32::{
        Foundation::{CloseHandle, HANDLE, WAIT_FAILED, WAIT_OBJECT_0},
        Media::{
            Audio::{
                AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY, AUDCLNT_BUFFERFLAGS_SILENT,
                AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR, AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK,
                AUDCLNT_STREAMFLAGS_NOPERSIST, IAudioCaptureClient, IAudioClient, IMMDevice,
                IMMDeviceEnumerator, MMDeviceEnumerator, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
                eCapture, eCommunications, eMultimedia, eRender,
            },
            KernelStreaming::KSDATAFORMAT_SUBTYPE_PCM,
            Multimedia::KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
        },
        System::{
            Com::{
                CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
                CoUninitialize,
            },
            Threading::{CreateEventW, INFINITE, SetEvent, WaitForMultipleObjects},
        },
    },
    core::PCWSTR,
};

use crate::{
    audio::{
        format::{
            NativeAudioFormat, WAVE_FORMAT_EXTENSIBLE_TAG, WAVE_FORMAT_IEEE_FLOAT_TAG,
            WAVE_FORMAT_PCM_TAG,
        },
        qpc_end_100ns,
    },
    domain::{
        audio_frame::{AudioFrameMeta, ChannelId, DiscontinuityReason, FrameFlags, SessionId},
        ledger::SourceKind,
        ports::{
            AudioCapturePort, CaptureHandoffError, CaptureHandoffPort, CapturedFrame, CoreError,
        },
    },
};

const START_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureMode {
    MicrophoneOnly,
    SystemLoopbackOnly,
    MicrophoneAndSystem,
}

impl CaptureMode {
    pub fn microphone_enabled(self) -> bool {
        matches!(self, Self::MicrophoneOnly | Self::MicrophoneAndSystem)
    }

    pub fn system_loopback_enabled(self) -> bool {
        matches!(self, Self::SystemLoopbackOnly | Self::MicrophoneAndSystem)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CaptureEndpointKind {
    Microphone,
    SystemLoopback,
}

impl CaptureEndpointKind {
    fn source_kind(self) -> SourceKind {
        match self {
            Self::Microphone => SourceKind::UserMic,
            Self::SystemLoopback => SourceKind::SystemLoopback,
        }
    }

    fn stream_flags(self) -> u32 {
        let common = AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_NOPERSIST;
        match self {
            Self::Microphone => common,
            Self::SystemLoopback => common | AUDCLNT_STREAMFLAGS_LOOPBACK,
        }
    }

    fn thread_name(self) -> &'static str {
        match self {
            Self::Microphone => "auralis-wasapi-mic",
            Self::SystemLoopback => "auralis-wasapi-loopback",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Microphone => "microphone",
            Self::SystemLoopback => "system loopback",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WasapiCaptureDescriptor {
    pub device_id: String,
    pub channel_id: ChannelId,
    pub source_kind: SourceKind,
    pub format: NativeAudioFormat,
    pub endpoint_buffer_frames: u32,
}

pub type MicrophoneCaptureDescriptor = WasapiCaptureDescriptor;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CaptureStartCursor {
    pub next_sequence: u64,
    pub last_qpc_end_100ns: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureGroupDescriptor {
    pub microphone: Option<WasapiCaptureDescriptor>,
    pub system_loopback: Option<WasapiCaptureDescriptor>,
}

struct CaptureRuntime {
    stop_event: OwnedEvent,
    thread: JoinHandle<Result<(), String>>,
}

struct WasapiEndpointCapture {
    endpoint: CaptureEndpointKind,
    channel_id: ChannelId,
    handoff: Arc<dyn CaptureHandoffPort>,
    runtime: Mutex<Option<CaptureRuntime>>,
}

impl WasapiEndpointCapture {
    fn new(
        endpoint: CaptureEndpointKind,
        channel_id: ChannelId,
        handoff: Arc<dyn CaptureHandoffPort>,
    ) -> Self {
        Self {
            endpoint,
            channel_id,
            handoff,
            runtime: Mutex::new(None),
        }
    }

    fn start_session(&self, session_id: SessionId) -> Result<WasapiCaptureDescriptor, CoreError> {
        self.start_session_at(session_id, CaptureStartCursor::default())
    }

    fn start_session_at(
        &self,
        session_id: SessionId,
        cursor: CaptureStartCursor,
    ) -> Result<WasapiCaptureDescriptor, CoreError> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| CoreError::Capture("WASAPI runtime lock is poisoned".into()))?;
        if runtime.is_some() {
            return Err(CoreError::InvalidState(format!(
                "{} capture is already running",
                self.endpoint.label()
            )));
        }

        let stop_event = OwnedEvent::new(false, false).map_err(capture_error)?;
        let stop_handle = stop_event.handle_value();
        let channel_id = self.channel_id.clone();
        let handoff = Arc::clone(&self.handoff);
        let endpoint = self.endpoint;
        let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
        let capture_thread = thread::Builder::new()
            .name(endpoint.thread_name().into())
            .spawn(move || {
                capture_thread(
                    session_id,
                    channel_id,
                    endpoint,
                    handoff,
                    cursor,
                    stop_handle,
                    ready_sender,
                )
            })
            .map_err(|error| {
                CoreError::Capture(format!("failed to spawn WASAPI thread: {error}"))
            })?;
        let started = match ready_receiver.recv_timeout(START_TIMEOUT) {
            Ok(result) => result,
            Err(error) => Err(format!("WASAPI startup handshake failed: {error}")),
        };
        if let Err(error) = started {
            let _ = stop_event.signal();
            let _ = capture_thread.join();
            return Err(CoreError::Capture(error));
        }
        let descriptor = started.map_err(CoreError::Capture)?;
        *runtime = Some(CaptureRuntime {
            stop_event,
            thread: capture_thread,
        });
        Ok(descriptor)
    }

    fn stop_session(&self) -> Result<(), CoreError> {
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| CoreError::Capture("WASAPI runtime lock is poisoned".into()))?
            .take();
        let Some(runtime) = runtime else {
            return Ok(());
        };
        runtime.stop_event.signal().map_err(capture_error)?;
        runtime
            .thread
            .join()
            .map_err(|_| CoreError::Capture("WASAPI capture thread panicked".into()))?
            .map_err(CoreError::Capture)
    }

    fn is_running(&self) -> bool {
        self.runtime
            .lock()
            .map(|runtime| {
                runtime
                    .as_ref()
                    .is_some_and(|runtime| !runtime.thread.is_finished())
            })
            .unwrap_or(false)
    }
}

impl Drop for WasapiEndpointCapture {
    fn drop(&mut self) {
        let _ = self.stop_session();
    }
}

pub struct WasapiMicrophoneCapture {
    inner: WasapiEndpointCapture,
}

impl WasapiMicrophoneCapture {
    pub fn new(channel_id: ChannelId, handoff: Arc<dyn CaptureHandoffPort>) -> Self {
        Self {
            inner: WasapiEndpointCapture::new(CaptureEndpointKind::Microphone, channel_id, handoff),
        }
    }

    pub fn start_session(
        &self,
        session_id: SessionId,
    ) -> Result<MicrophoneCaptureDescriptor, CoreError> {
        self.inner.start_session(session_id)
    }

    pub fn start_session_at(
        &self,
        session_id: SessionId,
        cursor: CaptureStartCursor,
    ) -> Result<MicrophoneCaptureDescriptor, CoreError> {
        self.inner.start_session_at(session_id, cursor)
    }

    pub fn stop_session(&self) -> Result<(), CoreError> {
        self.inner.stop_session()
    }

    pub fn is_running(&self) -> bool {
        self.inner.is_running()
    }
}

impl AudioCapturePort for WasapiMicrophoneCapture {
    fn start(&self, session_id: SessionId) -> Result<(), CoreError> {
        self.start_session(session_id).map(|_| ())
    }

    fn stop(&self) -> Result<(), CoreError> {
        self.stop_session()
    }
}

pub struct WasapiSystemLoopbackCapture {
    inner: WasapiEndpointCapture,
}

impl WasapiSystemLoopbackCapture {
    pub fn new(channel_id: ChannelId, handoff: Arc<dyn CaptureHandoffPort>) -> Self {
        Self {
            inner: WasapiEndpointCapture::new(
                CaptureEndpointKind::SystemLoopback,
                channel_id,
                handoff,
            ),
        }
    }

    pub fn start_session(
        &self,
        session_id: SessionId,
    ) -> Result<WasapiCaptureDescriptor, CoreError> {
        self.inner.start_session(session_id)
    }

    pub fn start_session_at(
        &self,
        session_id: SessionId,
        cursor: CaptureStartCursor,
    ) -> Result<WasapiCaptureDescriptor, CoreError> {
        self.inner.start_session_at(session_id, cursor)
    }

    pub fn stop_session(&self) -> Result<(), CoreError> {
        self.inner.stop_session()
    }

    pub fn is_running(&self) -> bool {
        self.inner.is_running()
    }
}

impl AudioCapturePort for WasapiSystemLoopbackCapture {
    fn start(&self, session_id: SessionId) -> Result<(), CoreError> {
        self.start_session(session_id).map(|_| ())
    }

    fn stop(&self) -> Result<(), CoreError> {
        self.stop_session()
    }
}

pub struct WasapiCaptureGroup {
    microphone: WasapiMicrophoneCapture,
    system_loopback: WasapiSystemLoopbackCapture,
}

impl WasapiCaptureGroup {
    pub fn new(
        microphone_channel_id: ChannelId,
        microphone_handoff: Arc<dyn CaptureHandoffPort>,
        system_channel_id: ChannelId,
        system_handoff: Arc<dyn CaptureHandoffPort>,
    ) -> Self {
        Self {
            microphone: WasapiMicrophoneCapture::new(microphone_channel_id, microphone_handoff),
            system_loopback: WasapiSystemLoopbackCapture::new(system_channel_id, system_handoff),
        }
    }

    pub fn start_session(
        &self,
        session_id: SessionId,
        mode: CaptureMode,
    ) -> Result<CaptureGroupDescriptor, CoreError> {
        self.start_session_at(
            session_id,
            mode,
            CaptureStartCursor::default(),
            CaptureStartCursor::default(),
        )
    }

    pub fn start_session_at(
        &self,
        session_id: SessionId,
        mode: CaptureMode,
        microphone_cursor: CaptureStartCursor,
        system_cursor: CaptureStartCursor,
    ) -> Result<CaptureGroupDescriptor, CoreError> {
        if self.microphone.is_running() || self.system_loopback.is_running() {
            return Err(CoreError::InvalidState(
                "capture group is already running".into(),
            ));
        }
        match mode {
            CaptureMode::MicrophoneOnly => Ok(CaptureGroupDescriptor {
                microphone: Some(
                    self.microphone
                        .start_session_at(session_id, microphone_cursor)?,
                ),
                system_loopback: None,
            }),
            CaptureMode::SystemLoopbackOnly => Ok(CaptureGroupDescriptor {
                microphone: None,
                system_loopback: Some(
                    self.system_loopback
                        .start_session_at(session_id, system_cursor)?,
                ),
            }),
            CaptureMode::MicrophoneAndSystem => {
                let microphone = self
                    .microphone
                    .start_session_at(session_id, microphone_cursor)?;
                match self
                    .system_loopback
                    .start_session_at(session_id, system_cursor)
                {
                    Ok(system_loopback) => Ok(CaptureGroupDescriptor {
                        microphone: Some(microphone),
                        system_loopback: Some(system_loopback),
                    }),
                    // Keep the microphone alive when only loopback startup
                    // fails; callers can report the typed error and continue
                    // the independent stream.
                    Err(error) => Err(error),
                }
            }
        }
    }

    pub fn stop_session(&self) -> Result<(), CoreError> {
        let microphone = self.microphone.stop_session();
        let system = self.system_loopback.stop_session();
        microphone.and(system)
    }

    pub fn microphone_running(&self) -> bool {
        self.microphone.is_running()
    }

    pub fn system_loopback_running(&self) -> bool {
        self.system_loopback.is_running()
    }
}

fn capture_thread(
    session_id: SessionId,
    channel_id: ChannelId,
    endpoint: CaptureEndpointKind,
    handoff: Arc<dyn CaptureHandoffPort>,
    cursor: CaptureStartCursor,
    stop_handle: usize,
    ready: mpsc::SyncSender<Result<WasapiCaptureDescriptor, String>>,
) -> Result<(), String> {
    let _apartment = ComApartment::initialize()?;
    let mut stream =
        match WasapiInputStream::open(session_id, channel_id, endpoint, handoff, cursor) {
            Ok(stream) => stream,
            Err(error) => {
                let _ = ready.send(Err(error.clone()));
                return Err(error);
            }
        };
    ready
        .send(Ok(stream.descriptor.clone()))
        .map_err(|error| format!("WASAPI startup receiver closed: {error}"))?;
    stream.run(HANDLE(stop_handle as *mut c_void))
}

struct WasapiInputStream {
    audio_client: IAudioClient,
    capture_client: IAudioCaptureClient,
    capture_event: OwnedEvent,
    descriptor: WasapiCaptureDescriptor,
    session_id: SessionId,
    handoff: Arc<dyn CaptureHandoffPort>,
    next_sequence: u64,
    resume_qpc_end_100ns: Option<u64>,
    queue_overflow_pending: bool,
    started: bool,
}

impl WasapiInputStream {
    fn open(
        session_id: SessionId,
        channel_id: ChannelId,
        endpoint: CaptureEndpointKind,
        handoff: Arc<dyn CaptureHandoffPort>,
        cursor: CaptureStartCursor,
    ) -> Result<Self, String> {
        // SAFETY: COM is initialized for this thread and every returned interface remains on it.
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(win_error)?;
            let device = match endpoint {
                CaptureEndpointKind::Microphone => enumerator
                    .GetDefaultAudioEndpoint(eCapture, eCommunications)
                    .map_err(win_error)?,
                CaptureEndpointKind::SystemLoopback => enumerator
                    .GetDefaultAudioEndpoint(eRender, eMultimedia)
                    .map_err(win_error)?,
            };
            let device_id = read_device_id(&device)?;
            let audio_client: IAudioClient =
                device.Activate(CLSCTX_ALL, None).map_err(win_error)?;
            let mix_format =
                CoTaskWaveFormat::new(audio_client.GetMixFormat().map_err(win_error)?)?;
            let format = parse_mix_format(mix_format.as_ptr())?;
            audio_client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    endpoint.stream_flags(),
                    0,
                    0,
                    mix_format.as_ptr(),
                    None,
                )
                .map_err(win_error)?;
            let capture_event = OwnedEvent::new(false, false).map_err(win_error)?;
            audio_client
                .SetEventHandle(capture_event.handle())
                .map_err(win_error)?;
            let capture_client: IAudioCaptureClient =
                audio_client.GetService().map_err(win_error)?;
            let endpoint_buffer_frames = audio_client.GetBufferSize().map_err(win_error)?;
            audio_client.Start().map_err(win_error)?;

            Ok(Self {
                audio_client,
                capture_client,
                capture_event,
                descriptor: WasapiCaptureDescriptor {
                    device_id,
                    channel_id,
                    source_kind: endpoint.source_kind(),
                    format,
                    endpoint_buffer_frames,
                },
                session_id,
                handoff,
                next_sequence: cursor.next_sequence,
                resume_qpc_end_100ns: cursor.last_qpc_end_100ns,
                queue_overflow_pending: false,
                started: true,
            })
        }
    }

    fn run(&mut self, stop_event: HANDLE) -> Result<(), String> {
        let handles = [stop_event, self.capture_event.handle()];
        loop {
            // SAFETY: both handles stay valid for the duration of this blocking event wait.
            let result = unsafe { WaitForMultipleObjects(&handles, false, INFINITE) };
            if result == WAIT_OBJECT_0 {
                return Ok(());
            }
            if result.0 == WAIT_OBJECT_0.0 + 1 {
                self.drain_available_packets()?;
                continue;
            }
            if result == WAIT_FAILED {
                return Err(format!(
                    "WaitForMultipleObjects failed: {}",
                    windows::core::Error::from_win32()
                ));
            }
            return Err(format!("unexpected WASAPI wait result: {}", result.0));
        }
    }

    fn drain_available_packets(&mut self) -> Result<(), String> {
        loop {
            // This drains packets only after the WASAPI event fires; it is not a timed polling loop.
            let available =
                unsafe { self.capture_client.GetNextPacketSize() }.map_err(win_error)?;
            if available == 0 {
                return Ok(());
            }
            self.capture_one_packet()?;
        }
    }

    fn capture_one_packet(&mut self) -> Result<(), String> {
        let mut data = ptr::null_mut();
        let mut frames = 0_u32;
        let mut flags = 0_u32;
        let mut device_position = 0_u64;
        let mut qpc_position = 0_u64;
        unsafe {
            self.capture_client
                .GetBuffer(
                    &mut data,
                    &mut frames,
                    &mut flags,
                    Some(&mut device_position),
                    Some(&mut qpc_position),
                )
                .map_err(win_error)?;
        }
        let packet = self.copy_packet(data, frames, flags, device_position, qpc_position);
        // SAFETY: every successful GetBuffer call is paired with exactly one ReleaseBuffer call.
        let release = unsafe { self.capture_client.ReleaseBuffer(frames) }.map_err(win_error);
        release?;
        let Some(frame) = packet? else {
            return Ok(());
        };
        match self.handoff.try_submit(frame) {
            Ok(()) => self.queue_overflow_pending = false,
            Err(CaptureHandoffError::Full) => self.queue_overflow_pending = true,
            Err(CaptureHandoffError::Closed) => {
                return Err(format!(
                    "capture handoff closed while {:?} was running",
                    self.descriptor.source_kind
                ));
            }
        }
        Ok(())
    }

    fn copy_packet(
        &mut self,
        data: *const u8,
        frames: u32,
        flags: u32,
        device_position: u64,
        qpc_position: u64,
    ) -> Result<Option<CapturedFrame>, String> {
        if frames == 0 {
            return Ok(None);
        }
        let byte_length = self
            .descriptor
            .format
            .payload_bytes(frames)
            .map_err(str::to_owned)?;
        let frame_flags = frame_flags(flags);
        let payload: Arc<[u8]> = if frame_flags.silent {
            vec![0_u8; byte_length].into()
        } else {
            if data.is_null() {
                return Err("WASAPI returned a null non-silent buffer".into());
            }
            // SAFETY: WASAPI owns a buffer of frames * block_align bytes until ReleaseBuffer.
            unsafe { slice::from_raw_parts(data, byte_length) }
                .to_vec()
                .into()
        };
        let resume_gap_frames = if frame_flags.timestamp_error {
            self.resume_qpc_end_100ns.take();
            0
        } else {
            self.resume_qpc_end_100ns
                .take()
                .and_then(|last_qpc| {
                    resume_gap_frames(
                        last_qpc,
                        qpc_position,
                        self.descriptor.format.sample_rate_hz,
                    )
                })
                .unwrap_or(0)
        };
        self.next_sequence = self
            .next_sequence
            .checked_add(resume_gap_frames)
            .ok_or_else(|| "WASAPI resumed sequence overflowed".to_string())?;
        let sequence_start = self.next_sequence;
        self.next_sequence = sequence_start
            .checked_add(u64::from(frames))
            .ok_or_else(|| "WASAPI channel sequence overflowed".to_string())?;
        let discontinuity = discontinuity_reason(
            self.queue_overflow_pending,
            frame_flags,
            resume_gap_frames > 0,
        );
        let qpc_start_100ns = if frame_flags.timestamp_error {
            0
        } else {
            qpc_position
        };
        let meta = AudioFrameMeta {
            session_id: self.session_id,
            channel_id: self.descriptor.channel_id.clone(),
            source_kind: self.descriptor.source_kind,
            sequence_start,
            sample_count_per_channel: frames,
            sample_rate_hz: self.descriptor.format.sample_rate_hz,
            channels: self.descriptor.format.channels,
            channel_mask: self.descriptor.format.channel_mask,
            sample_format: self.descriptor.format.sample_format,
            bits_per_sample: self.descriptor.format.bits_per_sample,
            valid_bits_per_sample: self.descriptor.format.valid_bits_per_sample,
            block_align: self.descriptor.format.block_align,
            qpc_start_100ns,
            qpc_end_100ns: qpc_end_100ns(
                qpc_start_100ns,
                frames,
                self.descriptor.format.sample_rate_hz,
            ),
            device_position: Some(device_position),
            flags: frame_flags,
            discontinuity,
        };
        meta.validate().map_err(str::to_owned)?;
        Ok(Some(CapturedFrame { meta, payload }))
    }
}

impl Drop for WasapiInputStream {
    fn drop(&mut self) {
        if self.started {
            // SAFETY: this interface belongs to the current COM capture thread.
            let _ = unsafe { self.audio_client.Stop() };
            self.started = false;
        }
    }
}

fn frame_flags(flags: u32) -> FrameFlags {
    FrameFlags {
        silent: flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0,
        timestamp_error: flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR.0 as u32 != 0,
        data_discontinuity: flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32 != 0,
    }
}

fn discontinuity_reason(
    queue_overflow_pending: bool,
    flags: FrameFlags,
    resume_gap: bool,
) -> Option<DiscontinuityReason> {
    if queue_overflow_pending {
        Some(DiscontinuityReason::QueueOverflow)
    } else if flags.data_discontinuity {
        Some(DiscontinuityReason::WasapiDataDiscontinuity)
    } else if flags.timestamp_error {
        Some(DiscontinuityReason::TimestampError)
    } else if resume_gap {
        Some(DiscontinuityReason::DevicePositionGap)
    } else {
        None
    }
}

fn resume_gap_frames(
    last_qpc_end_100ns: u64,
    qpc_start_100ns: u64,
    sample_rate: u32,
) -> Option<u64> {
    qpc_start_100ns
        .checked_sub(last_qpc_end_100ns)?
        .checked_mul(u64::from(sample_rate))
        .map(|scaled| scaled / 10_000_000)
}

unsafe fn parse_mix_format(format: *const WAVEFORMATEX) -> Result<NativeAudioFormat, String> {
    if format.is_null() {
        return Err("WASAPI returned a null mix format".into());
    }
    // SAFETY: caller owns a valid CoTaskMem WAVEFORMATEX allocation.
    let base = unsafe { format.read_unaligned() };
    let mut channel_mask = None;
    let mut valid_bits = None;
    let mut sub_format_tag = None;
    if base.wFormatTag == WAVE_FORMAT_EXTENSIBLE_TAG {
        let required_extra =
            u16::try_from(size_of::<WAVEFORMATEXTENSIBLE>() - size_of::<WAVEFORMATEX>())
                .map_err(|_| "WAVEFORMATEXTENSIBLE size overflowed")?;
        if base.cbSize < required_extra {
            return Err("WASAPI extensible format is truncated".into());
        }
        // SAFETY: cbSize proves the allocation includes the extensible tail.
        let extensible = unsafe { (format as *const WAVEFORMATEXTENSIBLE).read_unaligned() };
        channel_mask = Some(extensible.dwChannelMask);
        valid_bits = Some(unsafe { extensible.Samples.wValidBitsPerSample });
        let sub_format = extensible.SubFormat;
        sub_format_tag = if sub_format == KSDATAFORMAT_SUBTYPE_PCM {
            Some(u32::from(WAVE_FORMAT_PCM_TAG))
        } else if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
            Some(u32::from(WAVE_FORMAT_IEEE_FLOAT_TAG))
        } else {
            None
        };
    }
    NativeAudioFormat::from_wave_fields(
        base.wFormatTag,
        sub_format_tag,
        base.nSamplesPerSec,
        base.nChannels,
        channel_mask,
        base.wBitsPerSample,
        valid_bits,
        base.nBlockAlign,
    )
    .map_err(str::to_owned)
}

unsafe fn read_device_id(device: &IMMDevice) -> Result<String, String> {
    let id = unsafe { device.GetId() }.map_err(win_error)?;
    let value = unsafe { id.to_string() }.map_err(|error| error.to_string());
    unsafe { CoTaskMemFree(Some(id.0.cast())) };
    value
}

struct CoTaskWaveFormat(NonNull<WAVEFORMATEX>);

impl CoTaskWaveFormat {
    fn new(format: *mut WAVEFORMATEX) -> Result<Self, String> {
        NonNull::new(format)
            .map(Self)
            .ok_or_else(|| "WASAPI returned a null mix format".into())
    }

    fn as_ptr(&self) -> *const WAVEFORMATEX {
        self.0.as_ptr()
    }
}

impl Drop for CoTaskWaveFormat {
    fn drop(&mut self) {
        // SAFETY: pointer came from IAudioClient::GetMixFormat and is freed exactly once.
        unsafe { CoTaskMemFree(Some(self.0.as_ptr().cast())) };
    }
}

struct ComApartment;

impl ComApartment {
    fn initialize() -> Result<Self, String> {
        // SAFETY: paired with CoUninitialize by this thread-local guard.
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(win_error)?;
        Ok(Self)
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        // SAFETY: guard is dropped on the same thread that initialized COM.
        unsafe { CoUninitialize() };
    }
}

struct OwnedEvent {
    handle: usize,
}

impl OwnedEvent {
    fn new(manual_reset: bool, initial_state: bool) -> windows::core::Result<Self> {
        // SAFETY: null security attributes and unnamed event follow CreateEventW contract.
        let handle = unsafe { CreateEventW(None, manual_reset, initial_state, PCWSTR::null())? };
        Ok(Self {
            handle: handle.0 as usize,
        })
    }

    fn handle(&self) -> HANDLE {
        HANDLE(self.handle as *mut c_void)
    }

    fn handle_value(&self) -> usize {
        self.handle
    }

    fn signal(&self) -> windows::core::Result<()> {
        // SAFETY: handle is a live event owned by this guard.
        unsafe { SetEvent(self.handle()) }
    }
}

impl Drop for OwnedEvent {
    fn drop(&mut self) {
        // SAFETY: handle is closed once after every waiter has joined.
        let _ = unsafe { CloseHandle(self.handle()) };
    }
}

fn win_error(error: windows::core::Error) -> String {
    error.to_string()
}

fn capture_error(error: windows::core::Error) -> CoreError {
    CoreError::Capture(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_configuration_keeps_mic_and_system_streams_independent() {
        assert_eq!(
            CaptureEndpointKind::Microphone.source_kind(),
            SourceKind::UserMic
        );
        assert_eq!(
            CaptureEndpointKind::SystemLoopback.source_kind(),
            SourceKind::SystemLoopback
        );
        assert_eq!(
            CaptureEndpointKind::Microphone.stream_flags() & AUDCLNT_STREAMFLAGS_LOOPBACK,
            0
        );
        assert_ne!(
            CaptureEndpointKind::SystemLoopback.stream_flags() & AUDCLNT_STREAMFLAGS_LOOPBACK,
            0
        );
    }

    #[test]
    fn capture_modes_select_only_the_requested_independent_streams() {
        assert!(CaptureMode::MicrophoneOnly.microphone_enabled());
        assert!(!CaptureMode::MicrophoneOnly.system_loopback_enabled());
        assert!(!CaptureMode::SystemLoopbackOnly.microphone_enabled());
        assert!(CaptureMode::SystemLoopbackOnly.system_loopback_enabled());
        assert!(CaptureMode::MicrophoneAndSystem.microphone_enabled());
        assert!(CaptureMode::MicrophoneAndSystem.system_loopback_enabled());
    }

    #[test]
    fn wasapi_flags_preserve_silence_timestamp_and_discontinuity() {
        let flags = AUDCLNT_BUFFERFLAGS_SILENT.0 as u32
            | AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR.0 as u32
            | AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32;
        let parsed = frame_flags(flags);
        assert!(parsed.silent);
        assert!(parsed.timestamp_error);
        assert!(parsed.data_discontinuity);
        assert_eq!(
            discontinuity_reason(false, parsed, false),
            Some(DiscontinuityReason::WasapiDataDiscontinuity)
        );
    }

    #[test]
    fn queue_overflow_is_reported_before_other_discontinuities() {
        assert_eq!(
            discontinuity_reason(true, FrameFlags::default(), true),
            Some(DiscontinuityReason::QueueOverflow)
        );
    }

    #[test]
    fn resumed_qpc_gap_is_reported_after_wasapi_flags() {
        assert_eq!(
            discontinuity_reason(false, FrameFlags::default(), true),
            Some(DiscontinuityReason::DevicePositionGap)
        );
        assert_eq!(resume_gap_frames(10, 10_000_010, 48_000), Some(48_000));
    }

    #[test]
    fn extensible_wave_format_preserves_mask_and_float_subtype() {
        let format = WAVEFORMATEXTENSIBLE {
            Format: WAVEFORMATEX {
                wFormatTag: WAVE_FORMAT_EXTENSIBLE_TAG,
                nChannels: 2,
                nSamplesPerSec: 48_000,
                nAvgBytesPerSec: 384_000,
                nBlockAlign: 8,
                wBitsPerSample: 32,
                cbSize: 22,
            },
            Samples: windows::Win32::Media::Audio::WAVEFORMATEXTENSIBLE_0 {
                wValidBitsPerSample: 32,
            },
            dwChannelMask: 3,
            SubFormat: KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
        };
        let parsed = unsafe { parse_mix_format(&format.Format) }.unwrap();
        assert_eq!(parsed.sample_rate_hz, 48_000);
        assert_eq!(parsed.channels, 2);
        assert_eq!(parsed.channel_mask, Some(3));
        assert_eq!(
            parsed.sample_format,
            crate::domain::audio_frame::SampleFormat::Float32
        );
    }
}
