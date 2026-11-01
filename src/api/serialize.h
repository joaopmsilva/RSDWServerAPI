#pragma once
#include "../engine/dom_engine.h"
#include "../engine/world.h"

#include <string>
#include <vector>

namespace Serialize {

std::string Player(const DomEngine::PlayerInfo& player);
// What a character brings with them, for the leave and arrive events:
// {"skills":{skill:xp},"inventory":{item:count}|null,"personalChest":{...}|null,
//  "questsDone":[quest id]|null}
std::string Carried(const DomEngine::PlayerInfo& player);
std::string ItemCounts(const std::vector<std::pair<std::string, int32_t>>& items);
std::string Players(const std::vector<DomEngine::PlayerInfo>& players);
std::string Server(const DomEngine::ServerInfo& info);
std::string Discovery(const DomEngine::DiscoveryInfo& info);
std::string World(const DomWorld::State& world);

std::string PlayersTable(const std::vector<DomEngine::PlayerInfo>& players);

}
