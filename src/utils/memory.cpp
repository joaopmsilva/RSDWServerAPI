#include "memory.h"
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <mutex>
#include <vector>
#include <link.h>

namespace Mem {

namespace {

struct Region {
    uintptr_t start;
    uintptr_t end;
};

// The readable regions of /proc/self/maps, published as an immutable list so
// a check takes no lock: the mod reads the game's memory a million times per
// pass, partly on the game thread. A replaced list is kept a while before it's
// freed, as a reader may still be searching it.
struct Regions {
    std::vector<Region> list;
    uint64_t generation = 0;
};

std::atomic<const Regions*> g_Current{nullptr};
std::mutex g_RefreshMutex;
std::deque<std::pair<const Regions*, std::chrono::steady_clock::time_point>> g_Retired;
std::atomic<int64_t> g_LastRefreshMs{0};
uint64_t g_Generation = 0;

uintptr_t g_ImageStart = 0;
uintptr_t g_ImageEnd = 0;

// A miss reloads the list at most this often: freed or garbage addresses miss
// every time, and parsing /proc/self/maps takes a few milliseconds.
constexpr int64_t kRefreshEveryMs = 1000;

// The region the last hit on this thread fell in; most reads land in the same
// object, so this skips the search almost every time.
thread_local uintptr_t t_HitStart = 0;
thread_local uintptr_t t_HitEnd = 0;
thread_local uint64_t t_HitGeneration = 0;

int64_t NowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

void LoadRegionsLocked() {
    FILE* maps = fopen("/proc/self/maps", "r");
    if (!maps) return;

    Regions* next = new Regions();
    next->list.reserve(4096);

    char line[1024];
    while (fgets(line, sizeof(line), maps)) {
        unsigned long long start = 0, end = 0;
        char perms[8] = {};
        if (sscanf(line, "%llx-%llx %7s", &start, &end, perms) != 3) continue;
        if (perms[0] != 'r') continue;

        if (!next->list.empty() && next->list.back().end == (uintptr_t)start) {
            next->list.back().end = (uintptr_t)end;
        } else {
            next->list.push_back({(uintptr_t)start, (uintptr_t)end});
        }
    }
    fclose(maps);

    std::sort(next->list.begin(), next->list.end(),
              [](const Region& a, const Region& b) { return a.start < b.start; });
    next->generation = ++g_Generation;

    auto now = std::chrono::steady_clock::now();
    const Regions* old = g_Current.exchange(next, std::memory_order_acq_rel);
    if (old) g_Retired.emplace_back(old, now);
    while (!g_Retired.empty() && now - g_Retired.front().second > std::chrono::seconds(10)) {
        delete g_Retired.front().first;
        g_Retired.pop_front();
    }
    g_LastRefreshMs.store(NowMs(), std::memory_order_relaxed);
}

bool Contains(const Regions* regions, uintptr_t addr, size_t size) {
    if (!regions || regions->list.empty()) return false;
    const std::vector<Region>& list = regions->list;

    auto it = std::upper_bound(list.begin(), list.end(), addr,
                               [](uintptr_t value, const Region& r) { return value < r.start; });
    if (it == list.begin()) return false;
    --it;
    if (addr < it->start || addr + size > it->end) return false;

    t_HitStart = it->start;
    t_HitEnd = it->end;
    t_HitGeneration = regions->generation;
    return true;
}

int ImagePhdrCallback(struct dl_phdr_info* info, size_t, void* data) {
    if (info->dlpi_name && info->dlpi_name[0] != '\0') return 0;

    uintptr_t lowest = 0;
    uintptr_t highest = 0;
    bool first = true;
    for (int i = 0; i < info->dlpi_phnum; i++) {
        const ElfW(Phdr)& phdr = info->dlpi_phdr[i];
        if (phdr.p_type != PT_LOAD) continue;
        uintptr_t begin = (uintptr_t)info->dlpi_addr + (uintptr_t)phdr.p_vaddr;
        uintptr_t stop = begin + (uintptr_t)phdr.p_memsz;
        if (first || begin < lowest) lowest = begin;
        if (first || stop > highest) highest = stop;
        first = false;
    }
    if (first) return 0;

    uintptr_t* out = (uintptr_t*)data;
    out[0] = lowest;
    out[1] = highest;
    return 1;
}

}

void Init() {
    {
        std::lock_guard<std::mutex> lock(g_RefreshMutex);
        if (!g_Current.load(std::memory_order_acquire)) LoadRegionsLocked();
    }

    if (!g_ImageStart) {
        uintptr_t bounds[2] = {0, 0};
        dl_iterate_phdr(&ImagePhdrCallback, bounds);
        g_ImageStart = bounds[0];
        g_ImageEnd = bounds[1];
    }
}

void Refresh() {
    std::lock_guard<std::mutex> lock(g_RefreshMutex);
    LoadRegionsLocked();
}

bool Readable(const void* addr, size_t size) {
    uintptr_t value = (uintptr_t)addr;
    if (!value || size == 0) return false;
    if (value < 0x10000 || value >= 0x0000800000000000ULL) return false;
    if (value + size < value) return false;

    const Regions* regions = g_Current.load(std::memory_order_acquire);
    if (regions && t_HitGeneration == regions->generation && value >= t_HitStart && value + size <= t_HitEnd) {
        return true;
    }
    if (Contains(regions, value, size)) return true;

    // A miss: the game may have mapped new memory since the list was read.
    if (NowMs() - g_LastRefreshMs.load(std::memory_order_relaxed) < kRefreshEveryMs) return false;
    {
        std::lock_guard<std::mutex> lock(g_RefreshMutex);
        if (NowMs() - g_LastRefreshMs.load(std::memory_order_relaxed) >= kRefreshEveryMs) LoadRegionsLocked();
    }
    return Contains(g_Current.load(std::memory_order_acquire), value, size);
}

bool InImage(const void* addr) {
    uintptr_t value = (uintptr_t)addr;
    return g_ImageStart && value >= g_ImageStart && value < g_ImageEnd;
}

}
