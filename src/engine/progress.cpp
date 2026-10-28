// Quests, journal and skill perks: components on the player controller, read
// through field offsets looked up by name (reflection.h).
#include "dom_engine.h"
#include "native_call.h"
#include "process_event.h"
#include "reflection.h"
#include "../utils/logger.h"
#include "../utils/memory.h"

#include <chrono>
#include <cstring>
#include <map>
#include <mutex>
#include <unordered_map>

namespace DomEngine {

namespace {

struct Array {
    uintptr_t data = 0;
    int32_t num = 0;
};

Array ReadArray(uintptr_t address, int32_t elementSize, int32_t maxCount) {
    Array out;
    FUEArray raw = {};
    if (!Mem::Readable((void*)address, sizeof(raw))) return out;
    memcpy(&raw, (void*)address, sizeof(raw));
    if (!raw.Data || raw.Num <= 0 || raw.Num > maxCount) return out;
    if (!Mem::Readable(raw.Data, (size_t)elementSize * (size_t)raw.Num)) return out;
    out.data = (uintptr_t)raw.Data;
    out.num = raw.Num;
    return out;
}

// Display names from data assets don't change, so each is read once.
std::mutex g_TextMutex;
std::unordered_map<uintptr_t, std::string> g_Texts;
bool g_FirstTextLogged = false;

// The game's own UKismetTextLibrary::Conv_TextToString, which resolves string
// tables and localisation the way the game does. Looked up once a minute
// until found.
uintptr_t g_ToStringFunction = 0;
uintptr_t g_ToStringLibrary = 0;
int32_t g_ToStringIn = -1, g_ToStringOut = -1;

bool ResolveToString(const Engine* engine) {
    if (g_ToStringFunction && g_ToStringLibrary && g_ToStringIn >= 0 && g_ToStringOut >= 0) return true;
    static std::chrono::steady_clock::time_point lastTry;
    auto now = std::chrono::steady_clock::now();
    if (lastTry.time_since_epoch().count() && now - lastTry < std::chrono::seconds(60)) return false;
    lastTry = now;
    if (!g_ToStringFunction) g_ToStringFunction = engine->FindFunction("KismetTextLibrary", "Conv_TextToString");
    if (!g_ToStringLibrary) g_ToStringLibrary = engine->FindObject("KismetTextLibrary", true);
    g_ToStringIn = Reflect::OffsetIn(g_ToStringFunction, "InText");
    g_ToStringOut = Reflect::OffsetIn(g_ToStringFunction, "ReturnValue");
    bool ok = g_ToStringFunction && g_ToStringLibrary && g_ToStringIn >= 0 && g_ToStringOut > g_ToStringIn &&
              NativeCall::IsNative(g_ToStringFunction);
    if (!ok) LogMessage("Reflection: Conv_TextToString not usable yet, falling back to reading text directly");
    return ok;
}

// "" with ran=false when the game thread couldn't run it (try again later).
std::string TextToString(const Engine* engine, uintptr_t address, bool& ran) {
    ran = false;
    if (!ResolveToString(engine) || !GameThread::IsReady() || !GameThread::FrameLayoutReady()) return "";
    uint8_t params[0x80] = {};
    if (g_ToStringOut + 0x10 > (int32_t)sizeof(params) || !Mem::Readable((void*)address, 0x10)) return "";
    memcpy(params + g_ToStringIn, (void*)address, 0x10); // FText by reference: not copied, not released
    bool invoked = false;
    auto call = [&]() { invoked = NativeCall::Invoke(g_ToStringLibrary, g_ToStringFunction, params, (uintptr_t)g_ToStringOut); };
    if (GameThread::IsGameThread()) {
        call();
        ran = true;
    } else {
        ran = GameThread::RunSync(call, 2000);
    }
    if (!ran || !invoked) {
        ran = false;
        return "";
    }
    // The returned FString's buffer belongs to the game's allocator; it's left
    // alone (a few bytes per asset, once).
    return engine->ReadFString((uintptr_t)params + (uintptr_t)g_ToStringOut);
}

std::string CachedText(const Engine* engine, uintptr_t asset, int32_t offset, const char* what) {
    if (!asset || offset < 0) return "";
    uintptr_t key = asset + (uintptr_t)offset;
    std::lock_guard<std::mutex> lock(g_TextMutex);
    auto it = g_Texts.find(key);
    if (it != g_Texts.end()) return it->second;
    bool ran = false;
    std::string text = TextToString(engine, asset + (uintptr_t)offset, ran);
    if (!ran) {
        text = Reflect::ReadText(asset + (uintptr_t)offset);
        if (text.empty()) return ""; // not cached: try the game's function next time
    }
    if (!g_FirstTextLogged && !text.empty()) {
        g_FirstTextLogged = true;
        LogMessage(std::string("Reflection: first ") + what + " name read: '" + text + "'");
    }
    g_Texts[key] = text;
    return text;
}

// Journal entry classes are named JournalEntryKnow<Kind>Data / JournalEntry<Kind>Data.
std::string JournalKind(const Engine* engine, uintptr_t entry) {
    static const std::pair<const char*, const char*> kinds[] = {
        {"JournalEntryKnowLoreData", "lore"},       {"JournalEntryKnowPeopleData", "people"},
        {"JournalEntryKnowPlaceData", "places"},    {"JournalEntryKnowTreasureData", "treasure"},
        {"JournalEntryRecipeData", "recipes"},      {"JournalEntryWorldData", "world"},
        {"JournalItemData", "items"},
    };
    uintptr_t c = Mem::ReadPtr(entry + Offsets::UObject_Class);
    for (int depth = 0; c && depth < 8; depth++) {
        std::string name = engine->GetObjectName(c);
        for (const auto& kind : kinds) {
            if (name == kind.first) return kind.second;
        }
        c = Mem::ReadPtr(c + Offsets::UStruct_SuperStruct);
    }
    return "other";
}

}

void Engine::ReadQuests(PlayerInfo& info, uintptr_t component) const {
    int32_t questsOffset = Reflect::Offset("QuestProgressComponent", "Quests");
    int32_t size = Reflect::Size("QuestProgress");
    int32_t dataOffset = Reflect::Offset("QuestProgress", "Data");
    int32_t stateOffset = Reflect::Offset("QuestProgress", "State");
    int32_t objectiveOffset = Reflect::Offset("QuestProgress", "CurrentObjective");
    if (!component || questsOffset < 0 || size <= 0 || dataOffset < 0 || stateOffset < 0) return;

    int32_t mainOffset = Reflect::Offset("QuestData", "bIsMainQuest");
    int32_t taskOffset = Reflect::Offset("QuestData", "bIsTaskQuest");
    int32_t hiddenOffset = Reflect::Offset("QuestData", "bHideInQuestList");
    int32_t nameOffset = Reflect::Offset("QuestData", "QuestName");

    info.hasQuests = true;
    Array list = ReadArray(component + (uintptr_t)questsOffset, size, 4096);
    for (int32_t i = 0; i < list.num; i++) {
        uintptr_t entry = list.data + (uintptr_t)i * (uintptr_t)size;
        uintptr_t data = Mem::ReadPtr(entry + (uintptr_t)dataOffset);
        uint8_t state = Mem::ReadU8(entry + (uintptr_t)stateOffset);
        if (!data || state == 0) continue; // 0 = not given yet
        if (hiddenOffset >= 0 && Mem::ReadU8(data + (uintptr_t)hiddenOffset)) continue;

        QuestInfo quest;
        quest.id = GetObjectName(data);
        quest.name = CachedText(this, data, nameOffset, "quest");
        quest.complete = state == 2;
        if (mainOffset >= 0 && Mem::ReadU8(data + (uintptr_t)mainOffset)) quest.kind = "main";
        else if (taskOffset >= 0 && Mem::ReadU8(data + (uintptr_t)taskOffset)) quest.kind = "task";
        else quest.kind = "side";
        if (!quest.complete && objectiveOffset >= 0) {
            quest.objective = NameToString((uint32_t)Mem::ReadI32(entry + (uintptr_t)objectiveOffset),
                                           (uint32_t)Mem::ReadI32(entry + (uintptr_t)objectiveOffset + 4));
            if (quest.objective == "None") quest.objective.clear();
        }
        info.quests.push_back(quest);
    }
}

void Engine::ReadJournal(PlayerInfo& info, uintptr_t component) const {
    int32_t offset = Reflect::Offset("JournalComponent", "UnlockedJournalEntries");
    if (!component || offset < 0) return;

    info.hasJournal = true;
    Array list = ReadArray(component + (uintptr_t)offset, sizeof(uintptr_t), 100000);
    std::map<std::string, int32_t> counts;
    for (int32_t i = 0; i < list.num; i++) {
        uintptr_t entry = Mem::ReadPtr(list.data + (uintptr_t)i * sizeof(uintptr_t));
        if (!entry) continue;
        counts[JournalKind(this, entry)]++;
        info.journalEntries++;
    }
    for (const auto& kv : counts) info.journal.push_back({kv.first, kv.second});
}

void Engine::ReadPerks(PlayerInfo& info, uintptr_t component) const {
    int32_t statesOffset = Reflect::Offset("SkillPerkComponent", "SkillPerkRuntimeStates");
    int32_t size = Reflect::Size("SkillPerkRuntimeState");
    int32_t skillOffset = Reflect::Offset("SkillPerkRuntimeState", "AssociatedSkill");
    int32_t activeOffset = Reflect::Offset("SkillPerkRuntimeState", "ActivePerkDatas");
    if (!component || statesOffset < 0 || size <= 0 || skillOffset < 0 || activeOffset < 0) return;

    int32_t maxOffset = Reflect::Offset("SkillPerkComponent", "MaxActivePerks");
    int32_t nameOffset = Reflect::Offset("SkillPerkData", "PerkName");
    int32_t descriptionOffset = Reflect::Offset("SkillPerkData", "PerkDescription");

    info.hasPerks = true;
    if (maxOffset >= 0) info.maxActivePerks = Mem::ReadI32(component + (uintptr_t)maxOffset);
    Array states = ReadArray(component + (uintptr_t)statesOffset, size, 256);
    for (int32_t i = 0; i < states.num; i++) {
        uintptr_t state = states.data + (uintptr_t)i * (uintptr_t)size;
        std::string skill = GetObjectName(Mem::ReadPtr(state + (uintptr_t)skillOffset));
        Array active = ReadArray(state + (uintptr_t)activeOffset, sizeof(uintptr_t), 64);
        for (int32_t j = 0; j < active.num; j++) {
            uintptr_t data = Mem::ReadPtr(active.data + (uintptr_t)j * sizeof(uintptr_t));
            if (!data) continue;
            PerkInfo perk;
            perk.id = GetObjectName(data);
            perk.name = CachedText(this, data, nameOffset, "perk");
            perk.description = CachedText(this, data, descriptionOffset, "perk description");
            perk.skill = skill;
            info.perks.push_back(perk);
        }
    }
}

}
