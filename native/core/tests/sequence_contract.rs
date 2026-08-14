use auralis_core::domain::{
    audio_frame::{AudioFrameMeta, ChannelId, FrameFlags, SampleFormat, SessionId},
    ledger::SourceKind,
};

fn frame(seq: u64) -> AudioFrameMeta {
    AudioFrameMeta {
        session_id: SessionId(1),
        channel_id: ChannelId("user-mic".into()),
        source_kind: SourceKind::UserMic,
        sequence_start: seq,
        sample_count_per_channel: 480,
        sample_rate_hz: 48_000,
        channels: 2,
        channel_mask: None,
        sample_format: SampleFormat::Float32,
        qpc_start_100ns: 0,
        qpc_end_100ns: 100_000,
        device_position: Some(seq),
        flags: FrameFlags::default(),
        discontinuity: None,
    }
}

#[test]
fn sequence_gap_is_never_silent() {
    assert!(frame(0).validate().is_ok());
    assert_eq!(frame(0).sequence_end(), Some(480));
    assert!(frame(480).validates_after(480).is_ok());
    let gap = frame(960).validates_after(480).unwrap_err();
    assert_eq!(gap.expected_sequence, 480);
    assert_eq!(gap.observed_sequence, 960);
}

#[test]
fn invalid_frame_metadata_is_rejected_before_handoff() {
    let mut invalid = frame(u64::MAX);
    invalid.sample_rate_hz = 0;
    assert_eq!(invalid.validate(), Err("frame format is invalid"));

    invalid.sample_rate_hz = 48_000;
    assert_eq!(invalid.validate(), Err("frame sequence range overflowed"));
}
