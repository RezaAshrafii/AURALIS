use std::path::PathBuf;

use auralis_core::{
    domain::{
        audio_frame::{ChannelId, SampleFormat, SessionId},
        ledger::{
            AudioChannel, AudioChunk, AudioChunkState, CaptureState, DeviceState, Gap, GapReason,
            GapStatus, RecoveryState, Session, SourceKind,
        },
        ports::AudioLedgerPort,
    },
    storage::LedgerRepository,
};

fn assert_ledger_port<T: AudioLedgerPort>() {}

#[test]
fn public_ledger_contract_requires_explicit_gap_for_forward_sequence_jump() {
    assert_ledger_port::<LedgerRepository>();
    let mut repository = LedgerRepository::open_in_memory().unwrap();
    let session = Session {
        id: SessionId(0x1201),
        started_at_utc: "2026-08-14T00:00:00Z".into(),
        ended_at_utc: None,
        app_version: "0.12.0-test".into(),
        schema_version: 3,
        capture_state: CaptureState::Starting,
        recovery_state: RecoveryState::Clean,
        config_snapshot_json: "{}".into(),
    };
    let channel = AudioChannel {
        id: ChannelId("1201-user-mic".into()),
        session_id: session.id,
        source_kind: SourceKind::UserMic,
        device_id: Some("fixture-mic".into()),
        device_generation: 0,
        native_sample_rate: 44_100,
        native_channels: 1,
        channel_mask: Some(4),
        sample_format: SampleFormat::PcmI16,
        capture_state: CaptureState::Capturing,
        device_state: DeviceState::Available,
        recovery_state: RecoveryState::Clean,
        last_sequence: 0,
        last_qpc_100ns: None,
        last_device_position: None,
    };
    repository.create_session(&session).unwrap();
    repository.register_channel(&channel).unwrap();

    let chunk = AudioChunk {
        id: "chunk-after-loss".into(),
        session_id: session.id,
        channel_id: channel.id.clone(),
        seq_start: 441,
        seq_end: 882,
        qpc_start_100ns: 100_000,
        qpc_end_100ns: 200_000,
        device_position_start: Some(441),
        device_position_end: Some(882),
        sample_rate: 44_100,
        channels: 1,
        channel_mask: Some(4),
        sample_format: SampleFormat::PcmI16,
        path: PathBuf::from("1201/user-mic/chunk-after-loss.raw"),
        byte_length: 882,
        sha256_hex: "1".repeat(64),
        discontinuity: Some(GapReason::QueueOverflow),
        state: AudioChunkState::Finalized,
        created_at_utc: "2026-08-14T00:00:01Z".into(),
    };
    let gap = Gap {
        id: "gap-before-chunk".into(),
        session_id: session.id,
        channel_id: channel.id,
        seq_start: 0,
        seq_end: Some(441),
        qpc_detected_100ns: Some(100_000),
        expected_device_position: Some(0),
        observed_device_position: Some(441),
        reason: GapReason::QueueOverflow,
        detail_json: "{\"fixture\":true}".into(),
        attempts: 0,
        retry_at_utc: None,
        status: GapStatus::Open,
        created_at_utc: "2026-08-14T00:00:01Z".into(),
        resolved_at_utc: None,
    };

    assert!(repository.commit_chunk(&chunk, None).is_err());
    repository.commit_chunk(&chunk, Some(&gap)).unwrap();
    assert_eq!(repository.counts().unwrap(), (1, 1, 1, 1));
}
