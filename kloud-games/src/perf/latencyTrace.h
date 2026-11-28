/**
 * @file src/perf/latencyTrace.h
 * @brief Host-side latency tracing helpers for the capture, encode, and enqueue pipeline stages.
 */
#pragma once

// standard includes
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdlib>
#include <iomanip>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <unordered_set>
#include <vector>

/**
 * @brief Latency tracing primitives shared by the video pipeline and the unit tests.
 *
 * The tracing is opt-in through the `KLOUD_GAMES_TRACE_LATENCY` environment variable. When the
 * variable is absent (or not exactly `1`) the pipeline only pays for one cached boolean check.
 */
namespace perf {
  /// @brief Steady clock used for every pipeline timestamp.
  using clock_t = std::chrono::steady_clock;

  /// @brief Environment variable that enables latency tracing when set to `1`.
  inline constexpr std::string_view trace_env_var {"KLOUD_GAMES_TRACE_LATENCY"};

  /// @brief Default interval between aggregated trace reports.
  inline constexpr std::chrono::seconds default_report_interval {5};

  /**
   * @brief Convert a steady clock duration to milliseconds.
   *
   * @param duration Duration to convert.
   * @return Duration in milliseconds as a floating point value.
   */
  inline double to_ms(clock_t::duration duration) {
    return std::chrono::duration<double, std::milli> {duration}.count();
  }

  /**
   * @brief Parse the raw value of the latency trace environment variable.
   *
   * Only the exact string `1` enables tracing, so values such as `0`, `false`, or an empty string
   * keep the instrumentation disabled.
   *
   * @param value Raw environment value, or `nullptr` when the variable is unset.
   * @return True when tracing should be enabled.
   */
  inline bool parse_trace_env(const char *value) {
    return value != nullptr && std::string_view {value} == "1";
  }

  /**
   * @brief Report whether latency tracing is enabled.
   *
   * The environment is read exactly once and cached in a function local static, so the hot path is
   * a single boolean load when tracing is off.
   *
   * @return True when `KLOUD_GAMES_TRACE_LATENCY=1` was present on the first call.
   */
  inline bool trace_enabled() {
    static const bool enabled = parse_trace_env(std::getenv(trace_env_var.data()));
    return enabled;
  }

  /**
   * @brief Compute a nearest-rank percentile over ascending values.
   *
   * The rank is `ceil(percentage / 100 * count)` clamped to `[1, count]`, which is the definition
   * used by the baseline report. An empty input returns zero so callers do not need a separate
   * empty-histogram branch.
   *
   * @param sorted_values Values ordered from smallest to largest.
   * @param percentage Requested percentile in `[0, 100]`; out of range values are clamped.
   * @return The value at the nearest rank, or zero when `sorted_values` is empty.
   */
  inline double percentile(const std::vector<double> &sorted_values, double percentage) {
    if (sorted_values.empty()) {
      return 0.0;
    }

    const auto clamped = std::clamp(percentage, 0.0, 100.0);
    const auto rank = static_cast<std::size_t>(std::ceil(clamped / 100.0 * static_cast<double>(sorted_values.size())));
    const auto index = std::min(std::max<std::size_t>(rank, 1), sorted_values.size()) - 1;
    return sorted_values[index];
  }

  /**
   * @brief Percentile summary of one latency stage.
   */
  struct span_stats_t {
    std::size_t samples {};  ///< Number of samples that contributed to the summary.
    double p50_ms {};  ///< Median latency in milliseconds.
    double p95_ms {};  ///< 95th percentile latency in milliseconds.
    double p99_ms {};  ///< 99th percentile latency in milliseconds.
  };

  /**
   * @brief Sort a copy of the values and compute the p50, p95, and p99 latencies.
   *
   * @param values Latency samples in milliseconds, in any order.
   * @return Summary with zeroed percentiles when `values` is empty.
   */
  inline span_stats_t summarize_span(std::vector<double> values) {
    span_stats_t stats;
    stats.samples = values.size();
    if (values.empty()) {
      return stats;
    }

    std::sort(values.begin(), values.end());
    stats.p50_ms = percentile(values, 50.0);
    stats.p95_ms = percentile(values, 95.0);
    stats.p99_ms = percentile(values, 99.0);
    return stats;
  }

  /**
   * @brief Aggregated latency of one reporting window.
   */
  struct window_summary_t {
    std::size_t frames {};  ///< Number of frames recorded in the window.
    double window_s {};  ///< Wall clock duration of the window in seconds.
    double frames_per_second {};  ///< Frames per second observed in the window.
    span_stats_t capture_to_encode {};  ///< Capture timestamp to encoder submission.
    span_stats_t encode_to_queue {};  ///< Encoder submission to network queue enqueue.
    span_stats_t capture_to_queue {};  ///< Capture timestamp to network queue enqueue.
  };

  /**
   * @brief Result of recording one encoded packet.
   */
  struct record_result_t {
    bool first_packet_of_session {};  ///< True when the session key was never recorded before.
    double capture_to_queue_ms {};  ///< End-to-end latency of the recorded packet in milliseconds.
    std::optional<window_summary_t> summary {};  ///< Summary when the reporting interval elapsed.
  };

  /**
   * @brief Format one aggregated window as a single log line.
   *
   * The layout is stable because `scripts/measure-latency.ps1` parses it:
   * `latency_trace window=<s>s frames=<n> fps=<f> capture_to_encode_ms[p50=..,p95=..,p99=..]
   * encode_to_queue_ms[...] capture_to_queue_ms[...]`.
   *
   * @param summary Window summary to format.
   * @return One line without a trailing newline.
   */
  inline std::string format_summary_line(const window_summary_t &summary) {
    std::ostringstream line;
    line << std::fixed << std::setprecision(3)
         << "latency_trace window=" << summary.window_s
         << "s frames=" << summary.frames
         << " fps=" << std::setprecision(2) << summary.frames_per_second
         << std::setprecision(3)
         << " capture_to_encode_ms[p50=" << summary.capture_to_encode.p50_ms
         << ",p95=" << summary.capture_to_encode.p95_ms
         << ",p99=" << summary.capture_to_encode.p99_ms << ']'
         << " encode_to_queue_ms[p50=" << summary.encode_to_queue.p50_ms
         << ",p95=" << summary.encode_to_queue.p95_ms
         << ",p99=" << summary.encode_to_queue.p99_ms << ']'
         << " capture_to_queue_ms[p50=" << summary.capture_to_queue.p50_ms
         << ",p95=" << summary.capture_to_queue.p95_ms
         << ",p99=" << summary.capture_to_queue.p99_ms << ']';
    return line.str();
  }

  /**
   * @brief Format the first packet of a session as a single log line.
   *
   * @param capture_to_queue_ms End-to-end latency of the first encoded packet in milliseconds.
   * @return One line without a trailing newline.
   */
  inline std::string format_first_packet_line(double capture_to_queue_ms) {
    std::ostringstream line;
    line << std::fixed << std::setprecision(3)
         << "latency_trace first_packet capture_to_queue_ms=" << capture_to_queue_ms;
    return line.str();
  }

  /**
   * @brief Ordered marks of the session-start timeline.
   *
   * The timeline starts when the launch or resume request is received and ends when the first
   * encoded packet is enqueued. Stages are recorded from different threads (HTTP, RTSP, capture,
   * and encoder), so the collection itself is thread safe.
   */
  enum class startup_stage_e : std::size_t {
    request = 0,  ///< Launch or resume request received; the zero point of every delta.
    configure_display_start,  ///< Entering the display configuration call.
    configure_display_done,  ///< Display configuration call returned.
    enumerate_displays,  ///< Display enumeration returned, before encoder probing.
    probe_encoders_done,  ///< Encoder probing returned.
    display_created,  ///< Capture display object created for the session.
    encoder_created,  ///< Per-session encoder session created.
    first_packet,  ///< First encoded packet enqueued for the network thread.
    count  ///< Number of stages, used to size the mark array.
  };

  /**
   * @brief Map a startup stage to the key used in the trace line.
   *
   * @param stage Stage to name.
   * @return Key without the `_ms` suffix.
   */
  inline std::string_view startup_stage_key(startup_stage_e stage) {
    switch (stage) {
      case startup_stage_e::request:
        return "request";
      case startup_stage_e::configure_display_start:
        return "configure_display_start";
      case startup_stage_e::configure_display_done:
        return "configure_display";
      case startup_stage_e::enumerate_displays:
        return "enumerate_displays";
      case startup_stage_e::probe_encoders_done:
        return "probe_encoders";
      case startup_stage_e::display_created:
        return "display_created";
      case startup_stage_e::encoder_created:
        return "encoder_created";
      case startup_stage_e::first_packet:
        return "first_packet";
      case startup_stage_e::count:
        break;
    }

    return "unknown";
  }

  /**
   * @brief Collects the marks of one session start relative to the launch request.
   *
   * A timeline is only active between `begin()` and `reset()`. Marks recorded while inactive are
   * ignored, which keeps a boot-time encoder probe from polluting the timeline of a later session.
   * The class performs no I/O: callers decide when (and whether) to log the formatted line.
   */
  class startup_timeline_t {
  public:
    /**
     * @brief Start a new timeline.
     *
     * @param request Time the launch or resume request was received.
     */
    void begin(clock_t::time_point request);

    /**
     * @brief Record a stage at the current steady clock time.
     *
     * @param stage Stage that just completed.
     */
    void mark(startup_stage_e stage);

    /**
     * @brief Record a stage only when it has not been recorded yet.
     *
     * Used for the final `first_packet` mark: the caller can then emit exactly one session-start
     * line per `begin()` even when the allocator reuses a session key between connections.
     *
     * @param stage Stage that just completed.
     * @return True when this call recorded the mark; false when inactive or already marked.
     */
    bool mark_once(startup_stage_e stage);

    /**
     * @brief Record a stage at an explicit time.
     *
     * @param stage Stage that just completed.
     * @param at Time the stage completed.
     */
    void mark_at(startup_stage_e stage, clock_t::time_point at);

    /**
     * @brief Report whether a timeline is active.
     *
     * @return True after `begin()` until `reset()` or another `begin()`.
     */
    [[nodiscard]] bool active() const;

    /**
     * @brief Format every recorded mark as a single log line.
     *
     * Keys follow the declaration order of `startup_stage_e`; stages without a mark are omitted.
     * The layout is `latency_trace session_start <stage>_ms=<value> ...` with three decimals.
     *
     * @return One line without a trailing newline, or empty when inactive or unmarked.
     */
    [[nodiscard]] std::optional<std::string> format_line() const;

    /**
     * @brief Drop the current timeline and every recorded mark.
     */
    void reset();

  private:
    /// @brief Number of mark slots, including the implicit zero-point request stage.
    static constexpr std::size_t stage_count {static_cast<std::size_t>(startup_stage_e::count)};

    mutable std::mutex mutex_;  ///< Guards the timeline fields below.
    std::optional<clock_t::time_point> request_;  ///< Launch request time while the timeline is active.
    std::array<std::optional<double>, stage_count> marks_;  ///< Delta in milliseconds per stage.
  };

  inline void startup_timeline_t::begin(clock_t::time_point request) {
    std::lock_guard lock {mutex_};
    request_ = request;
    marks_.fill(std::nullopt);
  }

  inline void startup_timeline_t::mark(startup_stage_e stage) {
    mark_at(stage, clock_t::now());
  }

  inline bool startup_timeline_t::mark_once(startup_stage_e stage) {
    std::lock_guard lock {mutex_};
    if (!request_ || stage == startup_stage_e::request || stage == startup_stage_e::count) {
      return false;
    }

    auto &mark = marks_[static_cast<std::size_t>(stage)];
    if (mark) {
      return false;
    }

    mark = to_ms(clock_t::now() - *request_);
    return true;
  }

  inline void startup_timeline_t::mark_at(startup_stage_e stage, clock_t::time_point at) {
    std::lock_guard lock {mutex_};
    if (!request_ || stage == startup_stage_e::request || stage == startup_stage_e::count) {
      return;
    }

    marks_[static_cast<std::size_t>(stage)] = to_ms(at - *request_);
  }

  inline bool startup_timeline_t::active() const {
    std::lock_guard lock {mutex_};
    return request_.has_value();
  }

  inline std::optional<std::string> startup_timeline_t::format_line() const {
    std::lock_guard lock {mutex_};
    if (!request_) {
      return std::nullopt;
    }

    std::ostringstream line;
    line << std::fixed << std::setprecision(3) << "latency_trace session_start";

    bool has_mark {false};
    for (std::size_t index = static_cast<std::size_t>(startup_stage_e::request) + 1; index < stage_count; ++index) {
      if (!marks_[index]) {
        continue;
      }

      line << ' ' << startup_stage_key(static_cast<startup_stage_e>(index)) << "_ms=" << *marks_[index];
      has_mark = true;
    }

    if (!has_mark) {
      return std::nullopt;
    }

    return line.str();
  }

  inline void startup_timeline_t::reset() {
    std::lock_guard lock {mutex_};
    request_.reset();
    marks_.fill(std::nullopt);
  }

  /**
   * @brief Process-wide session-start timeline shared by the HTTP, video, and encoder threads.
   *
   * Sessions are started one at a time (the display preparation path only runs while no session is
   * active), so a single timeline covers the request → first packet window.
   *
   * @return Mutable reference to the singleton timeline.
   */
  inline startup_timeline_t &startup_timeline() {
    static startup_timeline_t timeline;
    return timeline;
  }

  /**
   * @brief Accumulates pipeline timestamps and produces periodic percentile summaries.
   *
   * The class performs no I/O: callers decide how (and whether) to log the returned summary. All
   * members are guarded by a mutex because sessions are encoded on their own encoder thread.
   */
  class trace_window_t {
  public:
    /**
     * @brief Create a window that reports every `report_interval`.
     *
     * @param report_interval Minimum wall clock duration between summaries.
     */
    explicit trace_window_t(std::chrono::milliseconds report_interval = default_report_interval);

    /**
     * @brief Record one frame that travelled through the whole pipeline.
     *
     * @param captured Capture timestamp attached to the frame by the platform backend.
     * @param submitted Time the frame was submitted to the encoder.
     * @param queued Time the encoded packet was enqueued for the network thread.
     * @param session_key Opaque session identifier used to detect the first packet of a session.
     * @return Record result, including a summary when the reporting interval elapsed.
     */
    record_result_t record(clock_t::time_point captured, clock_t::time_point submitted, clock_t::time_point queued, const void *session_key);

    /**
     * @brief Finish the current window and start a new one.
     *
     * @param now Timestamp used as the end of the finished window and the start of the next one.
     * @return Summary of the finished window.
     */
    window_summary_t take(clock_t::time_point now);

    /**
     * @brief Drop every recorded sample and session key.
     */
    void reset();

  private:
    /**
     * @brief Compute and reset the window while the mutex is already held.
     *
     * @param now Timestamp used as the end of the finished window.
     * @return Summary of the finished window.
     */
    window_summary_t take_locked(clock_t::time_point now);

    std::chrono::milliseconds report_interval_;  ///< Minimum duration between summaries.
    mutable std::mutex mutex_;  ///< Guards every field below.
    std::optional<clock_t::time_point> window_start_;  ///< First timestamp of the current window.
    std::size_t frames_ {};  ///< Frames recorded in the current window.
    std::vector<double> capture_to_encode_ms_;  ///< Samples of capture to encoder submission.
    std::vector<double> encode_to_queue_ms_;  ///< Samples of encoder submission to enqueue.
    std::vector<double> capture_to_queue_ms_;  ///< Samples of capture to enqueue.
    std::unordered_set<const void *> sessions_;  ///< Session keys already reported as first packet.
  };

  inline trace_window_t::trace_window_t(std::chrono::milliseconds report_interval):
      report_interval_ {report_interval} {
  }

  inline record_result_t trace_window_t::record(clock_t::time_point captured, clock_t::time_point submitted, clock_t::time_point queued, const void *session_key) {
    std::lock_guard lock {mutex_};

    if (!window_start_) {
      window_start_ = queued;
    }

    record_result_t result;
    result.first_packet_of_session = sessions_.insert(session_key).second;
    result.capture_to_queue_ms = to_ms(queued - captured);

    capture_to_encode_ms_.push_back(to_ms(submitted - captured));
    encode_to_queue_ms_.push_back(to_ms(queued - submitted));
    capture_to_queue_ms_.push_back(result.capture_to_queue_ms);
    ++frames_;

    if (queued - *window_start_ >= report_interval_) {
      result.summary = take_locked(queued);
    }

    return result;
  }

  inline window_summary_t trace_window_t::take(clock_t::time_point now) {
    std::lock_guard lock {mutex_};
    return take_locked(now);
  }

  inline window_summary_t trace_window_t::take_locked(clock_t::time_point now) {
    window_summary_t summary;
    summary.frames = frames_;
    summary.window_s = window_start_ ? std::chrono::duration<double> {now - *window_start_}.count() : 0.0;
    summary.frames_per_second = summary.window_s > 0.0 ? static_cast<double>(frames_) / summary.window_s : 0.0;
    summary.capture_to_encode = summarize_span(capture_to_encode_ms_);
    summary.encode_to_queue = summarize_span(encode_to_queue_ms_);
    summary.capture_to_queue = summarize_span(capture_to_queue_ms_);

    window_start_ = now;
    frames_ = 0;
    capture_to_encode_ms_.clear();
    encode_to_queue_ms_.clear();
    capture_to_queue_ms_.clear();

    return summary;
  }

  inline void trace_window_t::reset() {
    std::lock_guard lock {mutex_};
    window_start_.reset();
    frames_ = 0;
    capture_to_encode_ms_.clear();
    encode_to_queue_ms_.clear();
    capture_to_queue_ms_.clear();
    sessions_.clear();
  }

}  // namespace perf
