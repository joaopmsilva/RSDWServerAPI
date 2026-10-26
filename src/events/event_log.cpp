#include "event_log.h"

#include <chrono>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <utility>

namespace EventLog {

namespace {

constexpr size_t kCapacity = 500;

int64_t NowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

std::mutex g_Mutex;
std::condition_variable g_Changed;
std::deque<Event> g_Events;
uint64_t g_NextId = 1;
const int64_t g_BootId = NowMs();

}

void Push(Event event) {
    {
        std::lock_guard<std::mutex> lock(g_Mutex);
        event.id = g_NextId++;
        event.timeMs = NowMs();
        g_Events.push_back(std::move(event));
        if (g_Events.size() > kCapacity) g_Events.pop_front();
    }
    g_Changed.notify_all();
}

bool WaitForNewer(uint64_t afterId, int timeoutMs) {
    std::unique_lock<std::mutex> lock(g_Mutex);
    return g_Changed.wait_for(lock, std::chrono::milliseconds(timeoutMs), [afterId] { return g_NextId - 1 > afterId; });
}

std::vector<Event> Since(uint64_t afterId, size_t limit) {
    std::lock_guard<std::mutex> lock(g_Mutex);
    std::vector<Event> out;
    for (const Event& event : g_Events) {
        if (event.id <= afterId) continue;
        out.push_back(event);
        if (out.size() >= limit) break;
    }
    return out;
}

uint64_t LatestId() {
    std::lock_guard<std::mutex> lock(g_Mutex);
    return g_NextId - 1;
}

int64_t BootId() { return g_BootId; }

}
