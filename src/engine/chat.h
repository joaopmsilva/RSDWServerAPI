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

bool Initialize();
bool IsHooked();
const std::string& Status();

void AddListener(Listener listener);
void AddEventListener(EventListener listener);

void Poll();

bool Broadcast(const std::string& body, std::string& outError);

// A private line to one player, from any thread.
bool Whisper(const DomEngine::PlayerInfo& player, const std::string& body);

// The game's own owner / admin check, from any thread.
bool IsPlayerAdmin(const DomEngine::PlayerInfo& player);

// For /api/diagnostics.
bool CanBroadcast();
bool CanCheckAdmin();
// 1 found, 0 missing, -1 not checked yet (nobody has been online). detail says where.
int ChatComponentState(std::string& detail);

}
