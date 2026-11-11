/**
 * @file src/nvenc/nvenc_utils.h
 * @brief Declarations for NVENC utilities.
 */
#pragma once

// plafform includes
#ifdef _WIN32
  #include <dxgiformat.h>
#endif

// local includes
#include "nvenc_colorspace.h"
#include "nvenc_sdk.h"
#include "src/platform/common.h"
#include "src/video_colorspace.h"

namespace NVENC_NAMESPACE {

#ifdef _WIN32
  /**
   * @brief Convert an NVENC buffer format to the matching DXGI format.
   *
   * @param format Pixel, audio, or protocol format being converted.
   * @return DXGI texture format that matches the NVENC buffer format.
   */
  DXGI_FORMAT dxgi_format_from_nvenc_format(NV_ENC_BUFFER_FORMAT format);
#endif

  /**
   * @brief Convert a KLOUD_GAMES pixel format to the matching NVENC buffer format.
   *
   * @param format Pixel, audio, or protocol format being converted.
   * @return NVENC buffer format compatible with the KLOUD_GAMES pixel format.
   */
  NV_ENC_BUFFER_FORMAT nvenc_format_from_KLOUD_GAMES_format(platf::pix_fmt_e format);

  /**
   * @brief Convert KLOUD_GAMES colorspace metadata to NVENC VUI metadata.
   *
   * @param KLOUD_GAMES_colorspace KLOUD_GAMES colorspace.
   * @return NVENC colorspace and VUI fields for the KLOUD_GAMES metadata.
   */
  nvenc_colorspace_t nvenc_colorspace_from_KLOUD_GAMES_colorspace(const video::KLOUD_GAMES_colorspace_t &KLOUD_GAMES_colorspace);

}  // namespace NVENC_NAMESPACE
