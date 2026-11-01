#pragma once
#include "dom_engine.h"

#include <cstdint>
#include <functional>
#include <string>

namespace DomChat {

struct Message {
    std::string senderName;
    std::string senderNetId;
    std::string characterGuid;
    int32_t playerId = 0;
    std::string body;
};

struct PlayerEvent {
    std::string senderName;
    std::string senderNetId;
    std::string characterGuid;
    int32_t playerId = 0;
    std::string tag;
};

using Listener = std::function<void(const Message&)>;
using EventListener = std::function<void(const PlayerEvent&)>;

// Whatever the game hasn't loaded yet is looked for again by Poll.
bool Initialize();
bool IsHooked();
const std::string& Status();

void AddListener(Listener listener);
void AddEventListener(EventListener listener);

// Every tick, from the init thread, with that tick's players: finishes lookups,
// hands queued player events (deaths) to the listeners, hooks new chat components.
void Poll(const std::vector<DomEngine::PlayerInfo>& players);

bool Broadcast(const std::string& body, std::string& outError);

// A private line to one player, from any thread.
bool Whisper(const DomEngine::PlayerInfo& player, const std::string& body);

// The game's own owner / admin check, from any thread.
bool IsPlayerAdmin(const DomEngine::PlayerInfo& player);

// For /api/diagnostics.
bool CanBroadcast();
bool CanCheckAdmin();
// True while some chat function hasn't been found and is still being looked for.
bool StillLooking();
// 1 found, 0 missing, -1 not checked yet (nobody has been online). detail says where.
int ChatComponentState(std::string& detail);

}
