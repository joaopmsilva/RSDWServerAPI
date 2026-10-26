#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

// In-memory feed of chat, death, join and leave events, read through GET /api/events.
// Ids start at 1 each boot; BootId tells a reader the server restarted.
namespace EventLog {

struct Event {
    uint64_t id = 0;
    int64_t timeMs = 0;
    std::string type;
    std::string name;
    std::string netId;
    std::string characterGuid;
    int32_t playerId = 0;
    std::string message;
    std::string location;
    std::string cause;    // death: the game's event tag, when it sent one
    int32_t players = -1; // join / leave: players online afterwards
};

void Push(Event event);

// Events newer than afterId, oldest first.
std::vector<Event> Since(uint64_t afterId, size_t limit);

uint64_t LatestId();

// Blocks until an event newer than afterId exists or timeoutMs passes; true if
// there is one. Lets GET /api/events?wait= answer the moment something happens.
bool WaitForNewer(uint64_t afterId, int timeoutMs);

int64_t BootId();

}
