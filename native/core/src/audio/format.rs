use crate::domain::audio_frame::SampleFormat;

pub const WAVE_FORMAT_PCM_TAG: u16 = 0x0001;
pub const WAVE_FORMAT_IEEE_FLOAT_TAG: u16 = 0x0003;
pub const WAVE_FORMAT_EXTENSIBLE_TAG: u16 = 0xfffe;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NativeAudioFormat {
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub channel_mask: Option<u32>,
    pub sample_format: SampleFormat,
    pub bits_per_sample: u16,
    pub valid_bits_per_sample: u16,
    pub block_align: u16,
}

impl NativeAudioFormat {
    #[allow(clippy::too_many_arguments)]
    pub fn from_wave_fields(
        format_tag: u16,
        sub_format_tag: Option<u32>,
        sample_rate_hz: u32,
        channels: u16,
        channel_mask: Option<u32>,
        bits_per_sample: u16,
        valid_bits_per_sample: Option<u16>,
        block_align: u16,
    ) -> Result<Self, &'static str> {
        if sample_rate_hz == 0 || channels == 0 || bits_per_sample == 0 {
            return Err("WASAPI format has a zero rate, channel count, or bit depth");
        }
        let bytes_per_sample = u32::from(bits_per_sample).div_ceil(8);
        let minimum_block_align = u32::from(channels) * bytes_per_sample;
        if u32::from(block_align) < minimum_block_align {
            return Err("WASAPI block alignment is smaller than one interleaved frame");
        }

        let effective_tag = if format_tag == WAVE_FORMAT_EXTENSIBLE_TAG {
            sub_format_tag.unwrap_or(u32::from(WAVE_FORMAT_EXTENSIBLE_TAG))
        } else {
            u32::from(format_tag)
        };
        let sample_format = match (effective_tag, bits_per_sample) {
            (tag, 8) if tag == u32::from(WAVE_FORMAT_PCM_TAG) => SampleFormat::PcmU8,
            (tag, 16) if tag == u32::from(WAVE_FORMAT_PCM_TAG) => SampleFormat::PcmI16,
            (tag, 24) if tag == u32::from(WAVE_FORMAT_PCM_TAG) => SampleFormat::PcmI24,
            (tag, 32) if tag == u32::from(WAVE_FORMAT_PCM_TAG) => SampleFormat::PcmI32,
            (tag, 32) if tag == u32::from(WAVE_FORMAT_IEEE_FLOAT_TAG) => SampleFormat::Float32,
            (tag, _) => SampleFormat::Unknown(u16::try_from(tag).unwrap_or(u16::MAX)),
        };
        let valid_bits_per_sample = valid_bits_per_sample.unwrap_or(bits_per_sample);
        if valid_bits_per_sample == 0 || valid_bits_per_sample > bits_per_sample {
            return Err("WASAPI valid-bit count is outside the sample container");
        }

        Ok(Self {
            sample_rate_hz,
            channels,
            channel_mask,
            sample_format,
            bits_per_sample,
            valid_bits_per_sample,
            block_align,
        })
    }

    pub fn payload_bytes(self, frames: u32) -> Result<usize, &'static str> {
        usize::from(self.block_align)
            .checked_mul(usize::try_from(frames).map_err(|_| "frame count does not fit usize")?)
            .ok_or("WASAPI payload length overflowed")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_44khz_pcm_and_preserves_right_channel_mask() {
        let format = NativeAudioFormat::from_wave_fields(
            WAVE_FORMAT_PCM_TAG,
            None,
            44_100,
            1,
            Some(0x0000_0002),
            16,
            None,
            2,
        )
        .unwrap();

        assert_eq!(format.sample_format, SampleFormat::PcmI16);
        assert_eq!(format.channel_mask, Some(0x0000_0002));
        assert_eq!(format.payload_bytes(441).unwrap(), 882);
    }

    #[test]
    fn parses_48khz_extensible_float_without_downmixing() {
        let format = NativeAudioFormat::from_wave_fields(
            WAVE_FORMAT_EXTENSIBLE_TAG,
            Some(u32::from(WAVE_FORMAT_IEEE_FLOAT_TAG)),
            48_000,
            2,
            Some(0x0000_0003),
            32,
            Some(32),
            8,
        )
        .unwrap();

        assert_eq!(format.sample_format, SampleFormat::Float32);
        assert_eq!(format.channels, 2);
        assert_eq!(format.payload_bytes(480).unwrap(), 3_840);
    }

    #[test]
    fn rejects_invalid_block_alignment_and_valid_bits() {
        assert!(
            NativeAudioFormat::from_wave_fields(
                WAVE_FORMAT_PCM_TAG,
                None,
                48_000,
                2,
                None,
                16,
                None,
                2,
            )
            .is_err()
        );
        assert!(
            NativeAudioFormat::from_wave_fields(
                WAVE_FORMAT_EXTENSIBLE_TAG,
                Some(u32::from(WAVE_FORMAT_PCM_TAG)),
                48_000,
                1,
                Some(4),
                16,
                Some(24),
                2,
            )
            .is_err()
        );
    }
}
