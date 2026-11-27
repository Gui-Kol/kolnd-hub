/**
 * @file tests/unit/test_latency_trace.cpp
 * @brief Tests for host-side latency trace percentiles and window aggregation.
 */

// test includes
#include "../tests_common.h"

// standard includes
#include <algorithm>
#include <chrono>
#include <numeric>
#include <string>
#include <vector>

// local includes
#include <src/perf/latencyTrace.h>

using namespace std::chrono_literals;

TEST(LatencyTracePercentileTests, ComputesNearestRankPercentiles) {
  std::vector<double> values(100);
  std::iota(values.begin(), values.end(), 1.0);

  EXPECT_DOUBLE_EQ(perf::percentile(values, 1.0), 1.0);
  EXPECT_DOUBLE_EQ(perf::percentile(values, 50.0), 50.0);
  EXPECT_DOUBLE_EQ(perf::percentile(values, 95.0), 95.0);
  EXPECT_DOUBLE_EQ(perf::percentile(values, 99.0), 99.0);
  EXPECT_DOUBLE_EQ(perf::percentile(values, 100.0), 100.0);
}

TEST(LatencyTracePercentileTests, ClampsOutOfRangePercentiles) {
  const std::vector<double> values {4.0, 8.0, 15.0};

  EXPECT_DOUBLE_EQ(perf::percentile(values, -10.0), 4.0);
  EXPECT_DOUBLE_EQ(perf::percentile(values, 250.0), 15.0);
}

TEST(LatencyTracePercentileTests, EmptyHistogramReturnsZero) {
  const std::vector<double> values;

  EXPECT_DOUBLE_EQ(perf::percentile(values, 50.0), 0.0);

  const auto stats = perf::summarize_span(values);
  EXPECT_EQ(stats.samples, 0u);
  EXPECT_DOUBLE_EQ(stats.p50_ms, 0.0);
  EXPECT_DOUBLE_EQ(stats.p95_ms, 0.0);
  EXPECT_DOUBLE_EQ(stats.p99_ms, 0.0);
}

TEST(LatencyTracePercentileTests, SummarizeSpanSortsUnsortedSamples) {
  std::vector<double> values(100);
  std::iota(values.begin(), values.end(), 1.0);
  std::reverse(values.begin(), values.end());

  const auto stats = perf::summarize_span(values);
  EXPECT_EQ(stats.samples, 100u);
  EXPECT_DOUBLE_EQ(stats.p50_ms, 50.0);
  EXPECT_DOUBLE_EQ(stats.p95_ms, 95.0);
  EXPECT_DOUBLE_EQ(stats.p99_ms, 99.0);
}

TEST(LatencyTraceEnvTests, OnlyExactOneEnablesTracing) {
  EXPECT_TRUE(perf::parse_trace_env("1"));
  EXPECT_FALSE(perf::parse_trace_env(nullptr));
  EXPECT_FALSE(perf::parse_trace_env(""));
  EXPECT_FALSE(perf::parse_trace_env("0"));
  EXPECT_FALSE(perf::parse_trace_env("true"));
  EXPECT_FALSE(perf::parse_trace_env("10"));
}

TEST(LatencyTraceWindowTests, RecordsEveryStageAndReportsFirstPacketOnce) {
  perf::trace_window_t window {100ms};
  const auto base = perf::clock_t::time_point {} + 1s;
  const int session = 0;

  const auto first = window.record(base, base + 2ms, base + 5ms, &session);
  EXPECT_TRUE(first.first_packet_of_session);
  EXPECT_DOUBLE_EQ(first.capture_to_queue_ms, 5.0);
  EXPECT_FALSE(first.summary.has_value());

  const auto second = window.record(base + 10ms, base + 11ms, base + 20ms, &session);
  EXPECT_FALSE(second.first_packet_of_session);
  EXPECT_DOUBLE_EQ(second.capture_to_queue_ms, 10.0);
  EXPECT_FALSE(second.summary.has_value());

  const auto third = window.record(base + 100ms, base + 101ms, base + 120ms, &session);
  EXPECT_FALSE(third.first_packet_of_session);
  ASSERT_TRUE(third.summary.has_value());

  const auto &summary = *third.summary;
  EXPECT_EQ(summary.frames, 3u);
  EXPECT_DOUBLE_EQ(summary.window_s, 0.115);
  EXPECT_DOUBLE_EQ(summary.frames_per_second, 3.0 / 0.115);

  ASSERT_EQ(summary.capture_to_encode.samples, 3u);
  EXPECT_DOUBLE_EQ(summary.capture_to_encode.p50_ms, 1.0);

  ASSERT_EQ(summary.encode_to_queue.samples, 3u);
  EXPECT_DOUBLE_EQ(summary.encode_to_queue.p50_ms, 9.0);

  ASSERT_EQ(summary.capture_to_queue.samples, 3u);
  EXPECT_DOUBLE_EQ(summary.capture_to_queue.p50_ms, 10.0);
  EXPECT_DOUBLE_EQ(summary.capture_to_queue.p95_ms, 20.0);
}

TEST(LatencyTraceWindowTests, TracksSessionsIndependently) {
  perf::trace_window_t window {5s};
  const auto base = perf::clock_t::time_point {} + 1s;
  const int first_session = 1;
  const int second_session = 2;

  EXPECT_TRUE(window.record(base, base, base, &first_session).first_packet_of_session);
  EXPECT_FALSE(window.record(base, base, base, &first_session).first_packet_of_session);
  EXPECT_TRUE(window.record(base, base, base, &second_session).first_packet_of_session);
}

TEST(LatencyTraceWindowTests, EmptyWindowTakeReportsZeros) {
  perf::trace_window_t window {5s};

  const auto summary = window.take(perf::clock_t::time_point {} + 1s);
  EXPECT_EQ(summary.frames, 0u);
  EXPECT_DOUBLE_EQ(summary.window_s, 0.0);
  EXPECT_DOUBLE_EQ(summary.frames_per_second, 0.0);
  EXPECT_EQ(summary.capture_to_encode.samples, 0u);
  EXPECT_EQ(summary.encode_to_queue.samples, 0u);
  EXPECT_EQ(summary.capture_to_queue.samples, 0u);
}

TEST(LatencyTraceWindowTests, ResetForgetsSamplesAndSessions) {
  perf::trace_window_t window {5s};
  const auto base = perf::clock_t::time_point {} + 1s;
  const int session = 0;

  window.record(base, base, base + 1ms, &session);
  window.reset();

  EXPECT_TRUE(window.record(base, base, base + 1ms, &session).first_packet_of_session);
  EXPECT_EQ(window.take(base + 2ms).frames, 1u);
}

TEST(LatencyTraceFormatTests, FormatsSummaryLineForTheAnalysisScript) {
  perf::window_summary_t summary;
  summary.frames = 300;
  summary.window_s = 5.001;
  summary.frames_per_second = 59.98;
  summary.capture_to_encode = {300, 0.421, 0.913, 1.302};
  summary.encode_to_queue = {300, 0.512, 0.998, 1.512};
  summary.capture_to_queue = {300, 0.940, 1.800, 2.600};

  EXPECT_EQ(
    perf::format_summary_line(summary),
    "latency_trace window=5.001s frames=300 fps=59.98 "
    "capture_to_encode_ms[p50=0.421,p95=0.913,p99=1.302] "
    "encode_to_queue_ms[p50=0.512,p95=0.998,p99=1.512] "
    "capture_to_queue_ms[p50=0.940,p95=1.800,p99=2.600]"
  );
}

TEST(LatencyTraceFormatTests, FormatsFirstPacketLine) {
  EXPECT_EQ(
    perf::format_first_packet_line(12.3456),
    "latency_trace first_packet capture_to_queue_ms=12.346"
  );
}

TEST(LatencyTraceStartupTests, RecordsStagesRelativeToTheRequest) {
  perf::startup_timeline_t timeline;
  const auto request = perf::clock_t::time_point {} + 1s;

  EXPECT_FALSE(timeline.active());
  EXPECT_FALSE(timeline.format_line().has_value());

  timeline.begin(request);
  EXPECT_TRUE(timeline.active());

  timeline.mark_at(perf::startup_stage_e::configure_display_start, request + 5ms);
  timeline.mark_at(perf::startup_stage_e::configure_display_done, request + 10ms);
  timeline.mark_at(perf::startup_stage_e::enumerate_displays, request + 12ms);
  timeline.mark_at(perf::startup_stage_e::probe_encoders_done, request + 20ms);
  timeline.mark_at(perf::startup_stage_e::display_created, request + 30ms);
  timeline.mark_at(perf::startup_stage_e::encoder_created, request + 40ms);
  timeline.mark_at(perf::startup_stage_e::first_packet, request + 50ms);

  const auto line = timeline.format_line();
  ASSERT_TRUE(line.has_value());
  EXPECT_EQ(
    *line,
    "latency_trace session_start configure_display_start_ms=5.000 configure_display_ms=10.000 "
    "enumerate_displays_ms=12.000 probe_encoders_ms=20.000 display_created_ms=30.000 "
    "encoder_created_ms=40.000 first_packet_ms=50.000"
  );
}

TEST(LatencyTraceStartupTests, IgnoresMarksBeforeBegin) {
  perf::startup_timeline_t timeline;
  const auto request = perf::clock_t::time_point {} + 1s;

  timeline.mark_at(perf::startup_stage_e::first_packet, request + 5ms);
  EXPECT_FALSE(timeline.format_line().has_value());

  timeline.begin(request);
  EXPECT_FALSE(timeline.format_line().has_value());
  EXPECT_TRUE(timeline.active());
}

TEST(LatencyTraceStartupTests, OmitsStagesWithoutMarks) {
  perf::startup_timeline_t timeline;
  const auto request = perf::clock_t::time_point {} + 1s;

  timeline.begin(request);
  timeline.mark_at(perf::startup_stage_e::display_created, request + 7ms);

  const auto line = timeline.format_line();
  ASSERT_TRUE(line.has_value());
  EXPECT_EQ(*line, "latency_trace session_start display_created_ms=7.000");
}

TEST(LatencyTraceStartupTests, BeginAndResetClearPreviousMarks) {
  perf::startup_timeline_t timeline;
  const auto request = perf::clock_t::time_point {} + 1s;

  timeline.begin(request);
  timeline.mark_at(perf::startup_stage_e::first_packet, request + 50ms);
  EXPECT_TRUE(timeline.format_line().has_value());

  timeline.begin(request + 1s);
  EXPECT_FALSE(timeline.format_line().has_value());

  timeline.mark_at(perf::startup_stage_e::first_packet, request + 1s + 2ms);
  const auto line = timeline.format_line();
  ASSERT_TRUE(line.has_value());
  EXPECT_EQ(*line, "latency_trace session_start first_packet_ms=2.000");

  timeline.reset();
  EXPECT_FALSE(timeline.active());
  EXPECT_FALSE(timeline.format_line().has_value());
}

TEST(LatencyTraceStartupTests, SharedTimelineKeepsActiveStateUntilReset) {
  auto &timeline = perf::startup_timeline();
  timeline.reset();
  timeline.begin(perf::clock_t::time_point {} + 1s);

  EXPECT_TRUE(perf::startup_timeline().active());

  timeline.reset();
  EXPECT_FALSE(perf::startup_timeline().active());
}

TEST(LatencyTraceStartupTests, MarkOnceRecordsOnlyTheFirstCall) {
  perf::startup_timeline_t timeline;
  const auto request = perf::clock_t::time_point {} + 1s;

  EXPECT_FALSE(timeline.mark_once(perf::startup_stage_e::first_packet));

  timeline.begin(request);
  timeline.mark_at(perf::startup_stage_e::display_created, request + 5ms);

  EXPECT_TRUE(timeline.mark_once(perf::startup_stage_e::first_packet));
  const auto first_line = timeline.format_line();
  ASSERT_TRUE(first_line.has_value());
  EXPECT_NE(first_line->find("display_created_ms=5.000"), std::string::npos);
  EXPECT_NE(first_line->find(" first_packet_ms="), std::string::npos);

  EXPECT_FALSE(timeline.mark_once(perf::startup_stage_e::first_packet));
  EXPECT_EQ(*first_line, *timeline.format_line());
}
