use auralis_core::domain::audio_frame::{
    AudioFrameMeta, ChannelId, FrameFlags, SampleFormat, SessionId,
};
use auralis_core::domain::ledger::SourceKind;

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
        bits_per_sample: 16,
        valid_bits_per_sample: 16,
        block_align: 4,
        qpc_start_100ns: 0,
        qpc_end_100ns: 100_000,
        device_position: Some(seq),
        flags: FrameFlags::default(),
        discontinuity: None,
    }
}

#[test]
fn sequence_gap_is_never_silent() {
    assert!(frame(480).validates_after(480).is_ok());
    let gap = frame(960).validates_after(480).unwrap_err();
    assert_eq!(gap.expected_sequence, 480);
    assert_eq!(gap.observed_sequence, 960);
}
