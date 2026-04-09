// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Script action handlers — extracted from GameLogicSubsystem.
 *
 * Source parity: ScriptEngine action execution.
 * C++ reference: ScriptEngine::executeActions, ScriptActions.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type GL = any;
type ANY = any;

import type { CommandButtonDef, ObjectDef } from '@generals/ini-data';
import { MAP_XY_FACTOR } from '@generals/terrain';
import { readBooleanField, readCoord3DField, readNumericField, readStringField } from './ini-readers.js';
import { type BuildableStatus } from './production-prerequisites.js';
import {
  findCommandButtonDefByName, findCommandSetDefByName, findObjectDefByName,
  findScienceDefByName, findUpgradeDefByName, resolveUpgradeType,
} from './registry-lookups.js';
import { isSpecialPowerObjectRelationshipAllowed, resolveSharedShortcutSpecialPowerReadyFrame as resolveSharedShortcutSpecialPowerReadyFrameImpl } from './special-power-routing.js';
import { DEFAULT_SUPPLY_BOX_VALUE, SupplyTruckAIState, initializeWarehouseState as initializeWarehouseStateImpl } from './supply-chain.js';
import {
  DRAWABLE_FRAMES_PER_FLASH, LOCOMOTORSET_NORMAL, LOCOMOTORSET_PANIC, LOCOMOTORSET_WANDER,
  LOGIC_FRAME_MS, LOGIC_FRAME_RATE, MAX_DYNAMIC_WATER, MAX_SCRIPT_RADAR_EVENTS,
  NO_ATTACK_DISTANCE, PATHFIND_CELL_SIZE, RADAR_EVENT_BEACON_PULSE, RANK_TABLE,
  RELATIONSHIP_ALLIES, RELATIONSHIP_ENEMIES, RELATIONSHIP_NEUTRAL,
  SCRIPT_CONDITION_TYPE_ALIASES, SCRIPT_CONDITION_TYPE_NAMES_BY_INDEX,
  SCRIPT_CONDITION_TYPE_NAME_SET, SCRIPT_ENDGAME_MESSAGE_DURATION_FRAMES,
  SCRIPT_ENDGAME_QUICK_DURATION_FRAMES, SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT,
  SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT_ALLOW_SURRENDER, SCRIPT_KIND_OF_NAME_TO_BIT,
  SCRIPT_KIND_OF_NAME_TO_BIT_ALLOW_SURRENDER, SCRIPT_LOCAL_PLAYER,
  SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME, SCRIPT_RADAR_EVENT_TTL_FRAMES,
  SCRIPT_SKIRMISH_BASE_DEFENSE_MAX_ANGLE, SCRIPT_SKIRMISH_BASE_DEFENSE_MAX_ATTEMPTS,
  SCRIPT_SKIRMISH_DEFENSE_TEMPLATE_KEYWORDS,
  SCRIPT_SKIRMISH_PATH_BACKDOOR_LABEL, SCRIPT_SKIRMISH_PATH_CENTER_LABEL,
  SCRIPT_SKIRMISH_PATH_FLANK_LABEL, SCRIPT_TEAM_THE_PLAYER,
  SCRIPT_THE_PLAYER, SCRIPT_THIS_OBJECT, SCRIPT_THIS_PLAYER,
  SCRIPT_THIS_PLAYER_ENEMY, SCRIPT_THIS_TEAM, SCRIPT_WAYPOINT_PATH_LIMIT,
  SIGNIFICANTLY_ABOVE_TERRAIN_THRESHOLD, SOURCE_DEFAULT_MAX_SHOTS_TO_FIRE,
  SOURCE_FLASH_COLOR_WHITE,
} from './index.js';

// ---- Script constants ----
const SCRIPT_DIFFICULTY_EASY = 0;
const SCRIPT_DIFFICULTY_NORMAL = 1;
const SCRIPT_DIFFICULTY_HARD = 2;
/** Source parity: AIPlayer::MAX_STRUCTURES_TO_REPAIR. */

const SCRIPT_COMMAND_OPTION_NEED_TARGET_ENEMY_OBJECT = 0x00000001;
const SCRIPT_COMMAND_OPTION_NEED_TARGET_NEUTRAL_OBJECT = 0x00000002;
const SCRIPT_COMMAND_OPTION_NEED_TARGET_ALLY_OBJECT = 0x00000004;
const SCRIPT_COMMAND_OPTION_NEED_TARGET_POS = 0x00000020;
const SCRIPT_COMMAND_OPTION_ATTACK_OBJECTS_POSITION = 0x00001000;
const SCRIPT_COMMAND_OPTION_CAN_USE_WAYPOINTS = 0x00400000;
const SCRIPT_COMMAND_OPTION_NEED_OBJECT_TARGET = SCRIPT_COMMAND_OPTION_NEED_TARGET_ENEMY_OBJECT
  | SCRIPT_COMMAND_OPTION_NEED_TARGET_NEUTRAL_OBJECT
  | SCRIPT_COMMAND_OPTION_NEED_TARGET_ALLY_OBJECT;

const SCRIPT_COMMAND_OPTION_NAME_TO_MASK = new Map<string, number>([
  ['NEED_TARGET_ENEMY_OBJECT', SCRIPT_COMMAND_OPTION_NEED_TARGET_ENEMY_OBJECT],
  ['NEED_TARGET_NEUTRAL_OBJECT', SCRIPT_COMMAND_OPTION_NEED_TARGET_NEUTRAL_OBJECT],
  ['NEED_TARGET_ALLY_OBJECT', SCRIPT_COMMAND_OPTION_NEED_TARGET_ALLY_OBJECT],
  ['ALLOW_SHRUBBERY_TARGET', 0x00000010],
  ['NEED_TARGET_POS', SCRIPT_COMMAND_OPTION_NEED_TARGET_POS],
  ['NEED_UPGRADE', 0x00000040],
  ['NEED_SPECIAL_POWER_SCIENCE', 0x00000080],
  ['OK_FOR_MULTI_SELECT', 0x00000100],
  ['CONTEXTMODE_COMMAND', 0x00000200],
  ['CHECK_LIKE', 0x00000400],
  ['ALLOW_MINE_TARGET', 0x00000800],
  ['ATTACK_OBJECTS_POSITION', SCRIPT_COMMAND_OPTION_ATTACK_OBJECTS_POSITION],
  ['OPTION_ONE', 0x00002000],
  ['OPTION_TWO', 0x00004000],
  ['OPTION_THREE', 0x00008000],
  ['NOT_QUEUEABLE', 0x00010000],
  ['SINGLE_USE_COMMAND', 0x00020000],
  ['SCRIPT_ONLY', 0x00080000],
  ['IGNORES_UNDERPOWERED', 0x00100000],
  ['USES_MINE_CLEARING_WEAPONSET', 0x00200000],
  ['CAN_USE_WAYPOINTS', SCRIPT_COMMAND_OPTION_CAN_USE_WAYPOINTS],
  ['MUST_BE_STOPPED', 0x00800000],
]);

// ---- Script action type mapping ----
const SCRIPT_ACTION_TYPE_NUMERIC_TO_NAME = new Map<number, string>([
  [0, 'DEBUG_MESSAGE_BOX'],
  [1, 'SET_FLAG'],
  [2, 'SET_COUNTER'],
  [3, 'VICTORY'],
  [4, 'DEFEAT'],
  [5, 'NO_OP'],
  [6, 'SET_TIMER'],
  [7, 'PLAY_SOUND_EFFECT'],
  [8, 'ENABLE_SCRIPT'],
  [9, 'DISABLE_SCRIPT'],
  [10, 'CALL_SUBROUTINE'],
  [11, 'PLAY_SOUND_EFFECT_AT'],
  [12, 'DAMAGE_MEMBERS_OF_TEAM'],
  [13, 'MOVE_TEAM_TO'],
  [14, 'MOVE_CAMERA_TO'],
  [15, 'INCREMENT_COUNTER'],
  [16, 'DECREMENT_COUNTER'],
  [17, 'MOVE_CAMERA_ALONG_WAYPOINT_PATH'],
  [18, 'ROTATE_CAMERA'],
  [19, 'RESET_CAMERA'],
  [20, 'SET_MILLISECOND_TIMER'],
  [21, 'CAMERA_MOD_FREEZE_TIME'],
  [22, 'SET_VISUAL_SPEED_MULTIPLIER'],
  [23, 'CREATE_OBJECT'],
  [24, 'SUSPEND_BACKGROUND_SOUNDS'],
  [25, 'RESUME_BACKGROUND_SOUNDS'],
  [26, 'CAMERA_MOD_SET_FINAL_ZOOM'],
  [27, 'CAMERA_MOD_SET_FINAL_PITCH'],
  [28, 'CAMERA_MOD_FREEZE_ANGLE'],
  [29, 'CAMERA_MOD_SET_FINAL_SPEED_MULTIPLIER'],
  [30, 'CAMERA_MOD_SET_ROLLING_AVERAGE'],
  [31, 'CAMERA_MOD_FINAL_LOOK_TOWARD'],
  [32, 'TEAM_ATTACK_TEAM'],
  [33, 'TEAM_ATTACK_TEAM'],
  [34, 'MOVE_CAMERA_TO_SELECTION'],
  [36, 'TEAM_FOLLOW_WAYPOINTS'],
  [37, 'TEAM_SET_STATE'],
  [38, 'MOVE_NAMED_UNIT_TO'],
  [39, 'NAMED_ATTACK_NAMED'],
  [40, 'CREATE_NAMED_ON_TEAM_AT_WAYPOINT'],
  [41, 'CREATE_UNNAMED_ON_TEAM_AT_WAYPOINT'],
  [42, 'NAMED_APPLY_ATTACK_PRIORITY_SET'],
  [43, 'TEAM_APPLY_ATTACK_PRIORITY_SET'],
  [44, 'SET_BASE_CONSTRUCTION_SPEED'],
  [45, 'NAMED_SET_ATTITUDE'],
  [46, 'TEAM_SET_ATTITUDE'],
  [47, 'NAMED_ATTACK_AREA'],
  [48, 'NAMED_ATTACK_TEAM'],
  [49, 'TEAM_ATTACK_AREA'],
  [50, 'TEAM_ATTACK_NAMED'],
  [51, 'TEAM_LOAD_TRANSPORTS'],
  [52, 'NAMED_ENTER_NAMED'],
  [53, 'TEAM_ENTER_NAMED'],
  [54, 'NAMED_EXIT_ALL'],
  [55, 'TEAM_EXIT_ALL'],
  [56, 'NAMED_FOLLOW_WAYPOINTS'],
  [57, 'NAMED_GUARD'],
  [58, 'TEAM_GUARD'],
  [59, 'NAMED_HUNT'],
  [60, 'TEAM_HUNT'],
  [61, 'PLAYER_SELL_EVERYTHING'],
  [62, 'PLAYER_DISABLE_BASE_CONSTRUCTION'],
  [63, 'PLAYER_DISABLE_FACTORIES'],
  [64, 'PLAYER_DISABLE_UNIT_CONSTRUCTION'],
  [65, 'PLAYER_ENABLE_BASE_CONSTRUCTION'],
  [66, 'PLAYER_ENABLE_FACTORIES'],
  [67, 'PLAYER_ENABLE_UNIT_CONSTRUCTION'],
  [68, 'CAMERA_MOVE_HOME'],
  [69, 'BUILD_TEAM'],
  [70, 'NAMED_DAMAGE'],
  [71, 'NAMED_DELETE'],
  [72, 'TEAM_DELETE'],
  [73, 'NAMED_KILL'],
  [74, 'TEAM_KILL'],
  [75, 'PLAYER_KILL'],
  [76, 'DISPLAY_TEXT'],
  [77, 'CAMEO_FLASH'],
  [78, 'NAMED_FLASH'],
  [79, 'TEAM_FLASH'],
  [80, 'MOVIE_PLAY_FULLSCREEN'],
  [81, 'MOVIE_PLAY_RADAR'],
  [82, 'SOUND_PLAY_NAMED'],
  [83, 'SPEECH_PLAY'],
  [84, 'PLAYER_TRANSFER_OWNERSHIP_PLAYER'],
  [85, 'NAMED_TRANSFER_OWNERSHIP_PLAYER'],
  [86, 'PLAYER_RELATES_PLAYER'],
  [87, 'RADAR_CREATE_EVENT'],
  [88, 'RADAR_DISABLE'],
  [89, 'RADAR_ENABLE'],
  [90, 'MAP_REVEAL_AT_WAYPOINT'],
  [91, 'TEAM_AVAILABLE_FOR_RECRUITMENT'],
  [92, 'TEAM_COLLECT_NEARBY_FOR_TEAM'],
  [93, 'TEAM_MERGE_INTO_TEAM'],
  [94, 'DISABLE_INPUT'],
  [95, 'ENABLE_INPUT'],
  [96, 'PLAYER_HUNT'],
  [97, 'SOUND_AMBIENT_PAUSE'],
  [98, 'SOUND_AMBIENT_RESUME'],
  [99, 'MUSIC_SET_TRACK'],
  [100, 'SET_TREE_SWAY'],
  [101, 'DEBUG_STRING'],
  [102, 'MAP_REVEAL_ALL'],
  [103, 'TEAM_GARRISON_SPECIFIC_BUILDING'],
  [104, 'EXIT_SPECIFIC_BUILDING'],
  [105, 'TEAM_GARRISON_NEAREST_BUILDING'],
  [106, 'TEAM_EXIT_ALL_BUILDINGS'],
  [107, 'NAMED_GARRISON_SPECIFIC_BUILDING'],
  [108, 'NAMED_GARRISON_NEAREST_BUILDING'],
  [109, 'NAMED_EXIT_BUILDING'],
  [110, 'PLAYER_GARRISON_ALL_BUILDINGS'],
  [111, 'PLAYER_EXIT_ALL_BUILDINGS'],
  [112, 'TEAM_WANDER'],
  [113, 'TEAM_PANIC'],
  [114, 'SETUP_CAMERA'],
  [115, 'CAMERA_LETTERBOX_BEGIN'],
  [116, 'CAMERA_LETTERBOX_END'],
  [117, 'ZOOM_CAMERA'],
  [118, 'PITCH_CAMERA'],
  [119, 'CAMERA_FOLLOW_NAMED'],
  [120, 'OVERSIZE_TERRAIN'],
  [121, 'CAMERA_FADE_ADD'],
  [122, 'CAMERA_FADE_SUBTRACT'],
  [123, 'CAMERA_FADE_SATURATE'],
  [124, 'CAMERA_FADE_MULTIPLY'],
  [125, 'CAMERA_BW_MODE_BEGIN'],
  [126, 'CAMERA_BW_MODE_END'],
  [127, 'DRAW_SKYBOX_BEGIN'],
  [128, 'DRAW_SKYBOX_END'],
  [129, 'SET_ATTACK_PRIORITY_THING'],
  [130, 'SET_ATTACK_PRIORITY_KIND_OF'],
  [131, 'SET_DEFAULT_ATTACK_PRIORITY'],
  [132, 'CAMERA_STOP_FOLLOW'],
  [133, 'CAMERA_MOTION_BLUR'],
  [134, 'CAMERA_MOTION_BLUR_JUMP'],
  [135, 'CAMERA_MOTION_BLUR_FOLLOW'],
  [136, 'CAMERA_MOTION_BLUR_END_FOLLOW'],
  [137, 'FREEZE_TIME'],
  [138, 'UNFREEZE_TIME'],
  [139, 'SHOW_MILITARY_CAPTION'],
  [140, 'CAMERA_SET_AUDIBLE_DISTANCE'],
  [141, 'SET_STOPPING_DISTANCE'],
  [142, 'NAMED_SET_STOPPING_DISTANCE'],
  [143, 'SET_FPS_LIMIT'],
  [144, 'MUSIC_SET_VOLUME'],
  [145, 'MAP_SHROUD_AT_WAYPOINT'],
  [146, 'MAP_SHROUD_ALL'],
  [147, 'SET_RANDOM_TIMER'],
  [148, 'SET_RANDOM_MSEC_TIMER'],
  [149, 'STOP_TIMER'],
  [150, 'RESTART_TIMER'],
  [151, 'ADD_TO_MSEC_TIMER'],
  [152, 'SUB_FROM_MSEC_TIMER'],
  [153, 'TEAM_TRANSFER_TO_PLAYER'],
  [154, 'PLAYER_SET_MONEY'],
  [155, 'PLAYER_GIVE_MONEY'],
  [156, 'DISABLE_SPECIAL_POWER_DISPLAY'],
  [157, 'ENABLE_SPECIAL_POWER_DISPLAY'],
  [158, 'NAMED_HIDE_SPECIAL_POWER_DISPLAY'],
  [159, 'NAMED_SHOW_SPECIAL_POWER_DISPLAY'],
  [160, 'DISPLAY_COUNTDOWN_TIMER'],
  [161, 'HIDE_COUNTDOWN_TIMER'],
  [162, 'ENABLE_COUNTDOWN_TIMER_DISPLAY'],
  [163, 'DISABLE_COUNTDOWN_TIMER_DISPLAY'],
  [164, 'NAMED_STOP_SPECIAL_POWER_COUNTDOWN'],
  [165, 'NAMED_START_SPECIAL_POWER_COUNTDOWN'],
  [166, 'NAMED_SET_SPECIAL_POWER_COUNTDOWN'],
  [167, 'NAMED_ADD_SPECIAL_POWER_COUNTDOWN'],
  [168, 'NAMED_FIRE_SPECIAL_POWER_AT_WAYPOINT'],
  [169, 'NAMED_FIRE_SPECIAL_POWER_AT_NAMED'],
  [170, 'REFRESH_RADAR'],
  [171, 'CAMERA_TETHER_NAMED'],
  [172, 'CAMERA_STOP_TETHER_NAMED'],
  [173, 'CAMERA_SET_DEFAULT'],
  [174, 'NAMED_STOP'],
  [175, 'TEAM_STOP'],
  [176, 'TEAM_STOP_AND_DISBAND'],
  [177, 'RECRUIT_TEAM'],
  [178, 'TEAM_SET_OVERRIDE_RELATION_TO_TEAM'],
  [179, 'TEAM_REMOVE_OVERRIDE_RELATION_TO_TEAM'],
  [180, 'TEAM_REMOVE_ALL_OVERRIDE_RELATIONS'],
  [181, 'CAMERA_LOOK_TOWARD_OBJECT'],
  [182, 'NAMED_FIRE_WEAPON_FOLLOWING_WAYPOINT_PATH'],
  [183, 'TEAM_SET_OVERRIDE_RELATION_TO_PLAYER'],
  [184, 'TEAM_REMOVE_OVERRIDE_RELATION_TO_PLAYER'],
  [185, 'PLAYER_SET_OVERRIDE_RELATION_TO_TEAM'],
  [186, 'PLAYER_REMOVE_OVERRIDE_RELATION_TO_TEAM'],
  [187, 'UNIT_EXECUTE_SEQUENTIAL_SCRIPT'],
  [188, 'UNIT_EXECUTE_SEQUENTIAL_SCRIPT_LOOPING'],
  [189, 'UNIT_STOP_SEQUENTIAL_SCRIPT'],
  [190, 'TEAM_EXECUTE_SEQUENTIAL_SCRIPT'],
  [191, 'TEAM_EXECUTE_SEQUENTIAL_SCRIPT_LOOPING'],
  [192, 'TEAM_STOP_SEQUENTIAL_SCRIPT'],
  [193, 'UNIT_GUARD_FOR_FRAMECOUNT'],
  [194, 'UNIT_IDLE_FOR_FRAMECOUNT'],
  [195, 'TEAM_GUARD_FOR_FRAMECOUNT'],
  [196, 'TEAM_IDLE_FOR_FRAMECOUNT'],
  [197, 'WATER_CHANGE_HEIGHT'],
  [198, 'NAMED_USE_COMMANDBUTTON_ABILITY_ON_NAMED'],
  [199, 'NAMED_USE_COMMANDBUTTON_ABILITY_AT_WAYPOINT'],
  [200, 'WATER_CHANGE_HEIGHT_OVER_TIME'],
  [201, 'MAP_SWITCH_BORDER'],
  [202, 'TEAM_GUARD_POSITION'],
  [203, 'TEAM_GUARD_OBJECT'],
  [204, 'TEAM_GUARD_AREA'],
  [205, 'OBJECT_FORCE_SELECT'],
  [206, 'CAMERA_LOOK_TOWARD_WAYPOINT'],
  [207, 'UNIT_DESTROY_ALL_CONTAINED'],
  [208, 'RADAR_FORCE_ENABLE'],
  [209, 'RADAR_REVERT_TO_NORMAL'],
  [210, 'SCREEN_SHAKE'],
  [211, 'TECHTREE_MODIFY_BUILDABILITY_OBJECT'],
  [212, 'WAREHOUSE_SET_VALUE'],
  [213, 'OBJECT_CREATE_RADAR_EVENT'],
  [214, 'TEAM_CREATE_RADAR_EVENT'],
  [215, 'DISPLAY_CINEMATIC_TEXT'],
  [216, 'PLAY_SOUND_EFFECT_AT'],
  [217, 'SOUND_DISABLE_TYPE'],
  [218, 'SOUND_ENABLE_TYPE'],
  [219, 'SOUND_ENABLE_ALL'],
  [220, 'AUDIO_OVERRIDE_VOLUME_TYPE'],
  [221, 'AUDIO_RESTORE_VOLUME_TYPE'],
  [222, 'AUDIO_RESTORE_VOLUME_ALL_TYPE'],
  [223, 'INGAME_POPUP_MESSAGE'],
  [224, 'SET_CAVE_INDEX'],
  [225, 'NAMED_SET_HELD'],
  [226, 'NAMED_SET_TOPPLE_DIRECTION'],
  [227, 'UNIT_MOVE_TOWARDS_NEAREST_OBJECT_TYPE'],
  [228, 'TEAM_MOVE_TOWARDS_NEAREST_OBJECT_TYPE'],
  [229, 'MAP_REVEAL_ALL_PERM'],
  [230, 'MAP_REVEAL_ALL_UNDO_PERM'],
  [231, 'NAMED_SET_REPULSOR'],
  [232, 'TEAM_SET_REPULSOR'],
  [233, 'TEAM_WANDER_IN_PLACE'],
  [234, 'TEAM_INCREASE_PRIORITY'],
  [235, 'TEAM_DECREASE_PRIORITY'],
  [236, 'DISPLAY_COUNTER'],
  [237, 'HIDE_COUNTER'],
  [238, 'TEAM_USE_COMMANDBUTTON_ABILITY_ON_NAMED'],
  [239, 'TEAM_USE_COMMANDBUTTON_ABILITY_AT_WAYPOINT'],
  [240, 'NAMED_USE_COMMANDBUTTON_ABILITY'],
  [242, 'NAMED_FLASH_WHITE'],
  [243, 'TEAM_FLASH_WHITE'],
  [244, 'SKIRMISH_BUILD_BUILDING'],
  [245, 'SKIRMISH_FOLLOW_APPROACH_PATH'],
  [246, 'IDLE_ALL_UNITS'],
  [247, 'RESUME_SUPPLY_TRUCKING'],
  [248, 'NAMED_CUSTOM_COLOR'],
  [249, 'SKIRMISH_MOVE_TO_APPROACH_PATH'],
  [250, 'SKIRMISH_BUILD_BASE_DEFENSE_FRONT'],
  [251, 'SKIRMISH_FIRE_SPECIAL_POWER_AT_MOST_COST'],
  [252, 'NAMED_RECEIVE_UPGRADE'],
  [253, 'PLAYER_REPAIR_NAMED_STRUCTURE'],
  [254, 'SKIRMISH_BUILD_BASE_DEFENSE_FLANK'],
  [255, 'SKIRMISH_BUILD_STRUCTURE_FRONT'],
  [256, 'SKIRMISH_BUILD_STRUCTURE_FLANK'],
  [257, 'SKIRMISH_ATTACK_NEAREST_GROUP_WITH_VALUE'],
  [258, 'SKIRMISH_PERFORM_COMMANDBUTTON_ON_MOST_VALUABLE_OBJECT'],
  [259, 'SKIRMISH_WAIT_FOR_COMMANDBUTTON_AVAILABLE_ALL'],
  [260, 'SKIRMISH_WAIT_FOR_COMMANDBUTTON_AVAILABLE_PARTIAL'],
  [262, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NAMED'],
  [263, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_ENEMY_UNIT'],
  [264, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_GARRISONED_BUILDING'],
  [265, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_KINDOF'],
  [266, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_ENEMY_BUILDING'],
  [267, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_ENEMY_BUILDING_CLASS'],
  [268, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_OBJECTTYPE'],
  [269, 'TEAM_PARTIAL_USE_COMMANDBUTTON'],
  [270, 'TEAM_CAPTURE_NEAREST_UNOWNED_FACTION_UNIT'],
  [271, 'PLAYER_CREATE_TEAM_FROM_CAPTURED_UNITS'],
  [272, 'PLAYER_ADD_SKILLPOINTS'],
  [273, 'PLAYER_ADD_RANKLEVEL'],
  [274, 'PLAYER_SET_RANKLEVEL'],
  [275, 'PLAYER_SET_RANKLEVELLIMIT'],
  [276, 'PLAYER_GRANT_SCIENCE'],
  [277, 'PLAYER_PURCHASE_SCIENCE'],
  [278, 'TEAM_HUNT_WITH_COMMAND_BUTTON'],
  [279, 'TEAM_WAIT_FOR_NOT_CONTAINED_ALL'],
  [280, 'TEAM_WAIT_FOR_NOT_CONTAINED_PARTIAL'],
  [281, 'TEAM_FOLLOW_WAYPOINTS_EXACT'],
  [282, 'NAMED_FOLLOW_WAYPOINTS_EXACT'],
  [285, 'MOVIE_PLAY_FULLSCREEN'],
  [286, 'MOVIE_PLAY_RADAR'],
  [477, 'PLAYER_ADD_SKILLPOINTS'],
  [478, 'PLAYER_ADD_RANKLEVEL'],
  [479, 'PLAYER_SET_RANKLEVEL'],
  [480, 'PLAYER_SET_RANKLEVELLIMIT'],
  [481, 'PLAYER_GRANT_SCIENCE'],
  [482, 'PLAYER_PURCHASE_SCIENCE'],
  [483, 'TEAM_HUNT_WITH_COMMAND_BUTTON'],
  [287, 'OBJECTLIST_ADDOBJECTTYPE'],
  [288, 'OBJECTLIST_REMOVEOBJECTTYPE'],
  [289, 'MAP_REVEAL_PERMANENTLY_AT_WAYPOINT'],
  [290, 'MAP_UNDO_REVEAL_PERMANENTLY_AT_WAYPOINT'],
  [292, 'TEAM_SET_STEALTH_ENABLED'],
  [291, 'PLAYER_RELATES_PLAYER'],
  [295, 'OPTIONS_SET_DRAWICON_UI_MODE'],
  [293, 'RADAR_DISABLE'],
  [294, 'RADAR_ENABLE'],
  [296, 'LOCALDEFEAT'],
  [297, 'OPTIONS_SET_PARTICLE_CAP_MODE'],
  [298, 'PLAYER_SCIENCE_AVAILABILITY'],
  [299, 'DISABLE_INPUT'],
  [300, 'ENABLE_INPUT'],
  [301, 'PLAYER_SELECT_SKILLSET'],
  [302, 'SOUND_AMBIENT_PAUSE'],
  [303, 'NAMED_FACE_NAMED'],
  [304, 'NAMED_FACE_WAYPOINT'],
  [305, 'TEAM_FACE_NAMED'],
  [306, 'TEAM_FACE_WAYPOINT'],
  [307, 'COMMANDBAR_REMOVE_BUTTON_OBJECTTYPE'],
  [308, 'COMMANDBAR_ADD_BUTTON_OBJECTTYPE_SLOT'],
  [309, 'UNIT_SPAWN_NAMED_LOCATION_ORIENTATION'],
  [310, 'PLAYER_AFFECT_RECEIVING_EXPERIENCE'],
  [311, 'PLAYER_EXCLUDE_FROM_SCORE_SCREEN'],
  [312, 'TEAM_GUARD_SUPPLY_CENTER'],
  [313, 'ENABLE_SCORING'],
  [314, 'DISABLE_SCORING'],
  [315, 'SOUND_SET_VOLUME'],
  [316, 'SPEECH_SET_VOLUME'],
  [317, 'DISABLE_BORDER_SHROUD'],
  [318, 'ENABLE_BORDER_SHROUD'],
  [348, 'PLAYER_SET_MONEY'],
  [349, 'MUSIC_SET_VOLUME'],
  [319, 'OBJECT_ALLOW_BONUSES'],
  [320, 'SOUND_REMOVE_ALL_DISABLED'],
  [321, 'SOUND_REMOVE_TYPE'],
  [322, 'TEAM_GUARD_IN_TUNNEL_NETWORK'],
  [323, 'QUICKVICTORY'],
  [324, 'QUICKVICTORY'],
  [326, 'CAMERA_FADE_ADD'],
  [327, 'CAMERA_FADE_SUBTRACT'],
  [328, 'CAMERA_FADE_SATURATE'],
  [329, 'CAMERA_FADE_MULTIPLY'],
  [330, 'CAMERA_BW_MODE_BEGIN'],
  [331, 'CAMERA_BW_MODE_END'],
  [332, 'DRAW_SKYBOX_BEGIN'],
  [333, 'DRAW_SKYBOX_END'],
  [334, 'NAMED_SET_EVAC_LEFT_OR_RIGHT'],
  [335, 'ENABLE_OBJECT_SOUND'],
  [336, 'DISABLE_OBJECT_SOUND'],
  [337, 'NAMED_USE_COMMANDBUTTON_ABILITY_USING_WAYPOINT_PATH'],
  [338, 'CAMERA_MOTION_BLUR'],
  [339, 'CAMERA_MOTION_BLUR_JUMP'],
  [340, 'CAMERA_MOTION_BLUR_FOLLOW'],
  [341, 'CAMERA_MOTION_BLUR_END_FOLLOW'],
  [342, 'SHOW_WEATHER'],
  [343, 'UNFREEZE_TIME'],
  [344, 'SHOW_MILITARY_CAPTION'],
  [345, 'CAMERA_SET_AUDIBLE_DISTANCE'],
  [346, 'SET_STOPPING_DISTANCE'],
  [347, 'NAMED_SET_STOPPING_DISTANCE'],
  [351, 'MAP_SHROUD_ALL'],
  [361, 'DISABLE_SPECIAL_POWER_DISPLAY'],
  [362, 'ENABLE_SPECIAL_POWER_DISPLAY'],
  [363, 'NAMED_HIDE_SPECIAL_POWER_DISPLAY'],
  [364, 'NAMED_SHOW_SPECIAL_POWER_DISPLAY'],
  [365, 'DISPLAY_COUNTDOWN_TIMER'],
  [366, 'HIDE_COUNTDOWN_TIMER'],
  [367, 'ENABLE_COUNTDOWN_TIMER_DISPLAY'],
  [368, 'DISABLE_COUNTDOWN_TIMER_DISPLAY'],
  [369, 'NAMED_STOP_SPECIAL_POWER_COUNTDOWN'],
  [370, 'NAMED_START_SPECIAL_POWER_COUNTDOWN'],
  [371, 'NAMED_SET_SPECIAL_POWER_COUNTDOWN'],
  [372, 'NAMED_ADD_SPECIAL_POWER_COUNTDOWN'],
  [373, 'NAMED_FIRE_SPECIAL_POWER_AT_WAYPOINT'],
  [374, 'NAMED_FIRE_SPECIAL_POWER_AT_NAMED'],
  [375, 'REFRESH_RADAR'],
  [376, 'CAMERA_TETHER_NAMED'],
  [377, 'CAMERA_STOP_TETHER_NAMED'],
  [378, 'CAMERA_SET_DEFAULT'],
  [379, 'NAMED_STOP'],
  [380, 'TEAM_STOP'],
  [381, 'TEAM_STOP_AND_DISBAND'],
  [383, 'TEAM_SET_OVERRIDE_RELATION_TO_TEAM'],
  [384, 'TEAM_REMOVE_OVERRIDE_RELATION_TO_TEAM'],
  [385, 'TEAM_REMOVE_ALL_OVERRIDE_RELATIONS'],
  [386, 'CAMERA_LOOK_TOWARD_OBJECT'],
  [387, 'NAMED_FIRE_WEAPON_FOLLOWING_WAYPOINT_PATH'],
  [388, 'TEAM_SET_OVERRIDE_RELATION_TO_PLAYER'],
  [389, 'TEAM_REMOVE_OVERRIDE_RELATION_TO_PLAYER'],
  [390, 'PLAYER_SET_OVERRIDE_RELATION_TO_TEAM'],
  [391, 'PLAYER_REMOVE_OVERRIDE_RELATION_TO_TEAM'],
  [392, 'UNIT_EXECUTE_SEQUENTIAL_SCRIPT'],
  [393, 'UNIT_EXECUTE_SEQUENTIAL_SCRIPT_LOOPING'],
  [394, 'UNIT_STOP_SEQUENTIAL_SCRIPT'],
  [395, 'TEAM_EXECUTE_SEQUENTIAL_SCRIPT'],
  [396, 'TEAM_EXECUTE_SEQUENTIAL_SCRIPT_LOOPING'],
  [397, 'TEAM_STOP_SEQUENTIAL_SCRIPT'],
  [398, 'UNIT_GUARD_FOR_FRAMECOUNT'],
  [399, 'UNIT_IDLE_FOR_FRAMECOUNT'],
  [400, 'TEAM_GUARD_FOR_FRAMECOUNT'],
  [401, 'TEAM_IDLE_FOR_FRAMECOUNT'],
  [402, 'WATER_CHANGE_HEIGHT'],
  [403, 'NAMED_USE_COMMANDBUTTON_ABILITY_ON_NAMED'],
  [404, 'NAMED_USE_COMMANDBUTTON_ABILITY_AT_WAYPOINT'],
  [405, 'WATER_CHANGE_HEIGHT_OVER_TIME'],
  [406, 'MAP_SWITCH_BORDER'],
  [407, 'TEAM_GUARD_POSITION'],
  [408, 'TEAM_GUARD_OBJECT'],
  [409, 'TEAM_GUARD_AREA'],
  [410, 'OBJECT_FORCE_SELECT'],
  [411, 'CAMERA_LOOK_TOWARD_WAYPOINT'],
  [412, 'UNIT_DESTROY_ALL_CONTAINED'],
  [413, 'RADAR_FORCE_ENABLE'],
  [414, 'RADAR_REVERT_TO_NORMAL'],
  [241, 'TEAM_FOLLOW_WAYPOINTS'],
  [261, 'NAMED_FOLLOW_WAYPOINTS'],
  [415, 'SCREEN_SHAKE'],
  [416, 'TECHTREE_MODIFY_BUILDABILITY_OBJECT'],
  [417, 'WAREHOUSE_SET_VALUE'],
  [418, 'OBJECT_CREATE_RADAR_EVENT'],
  [419, 'TEAM_CREATE_RADAR_EVENT'],
  [420, 'DISPLAY_CINEMATIC_TEXT'],
  [422, 'SOUND_DISABLE_TYPE'],
  [423, 'SOUND_ENABLE_TYPE'],
  [424, 'SOUND_ENABLE_ALL'],
  [425, 'AUDIO_OVERRIDE_VOLUME_TYPE'],
  [426, 'AUDIO_RESTORE_VOLUME_TYPE'],
  [427, 'AUDIO_RESTORE_VOLUME_ALL_TYPE'],
  [428, 'INGAME_POPUP_MESSAGE'],
  [429, 'SET_CAVE_INDEX'],
  [430, 'NAMED_SET_HELD'],
  [431, 'NAMED_SET_TOPPLE_DIRECTION'],
  [432, 'UNIT_MOVE_TOWARDS_NEAREST_OBJECT_TYPE'],
  [433, 'TEAM_MOVE_TOWARDS_NEAREST_OBJECT_TYPE'],
  [434, 'MAP_REVEAL_ALL_PERM'],
  [435, 'MAP_REVEAL_ALL_UNDO_PERM'],
  [436, 'NAMED_SET_REPULSOR'],
  [437, 'TEAM_SET_REPULSOR'],
  [438, 'TEAM_WANDER_IN_PLACE'],
  [439, 'TEAM_INCREASE_PRIORITY'],
  [440, 'TEAM_DECREASE_PRIORITY'],
  [441, 'DISPLAY_COUNTER'],
  [442, 'HIDE_COUNTER'],
  [443, 'TEAM_USE_COMMANDBUTTON_ABILITY_ON_NAMED'],
  [444, 'TEAM_USE_COMMANDBUTTON_ABILITY_AT_WAYPOINT'],
  [445, 'NAMED_USE_COMMANDBUTTON_ABILITY'],
  [446, 'TEAM_USE_COMMANDBUTTON_ABILITY'],
  [447, 'NAMED_FLASH_WHITE'],
  [448, 'TEAM_FLASH_WHITE'],
  [449, 'SKIRMISH_BUILD_BUILDING'],
  [450, 'SKIRMISH_FOLLOW_APPROACH_PATH'],
  [451, 'IDLE_ALL_UNITS'],
  [452, 'RESUME_SUPPLY_TRUCKING'],
  [453, 'NAMED_CUSTOM_COLOR'],
  [454, 'SKIRMISH_MOVE_TO_APPROACH_PATH'],
  [455, 'SKIRMISH_BUILD_BASE_DEFENSE_FRONT'],
  [456, 'SKIRMISH_FIRE_SPECIAL_POWER_AT_MOST_COST'],
  [457, 'NAMED_RECEIVE_UPGRADE'],
  [458, 'PLAYER_REPAIR_NAMED_STRUCTURE'],
  [459, 'SKIRMISH_BUILD_BASE_DEFENSE_FLANK'],
  [460, 'SKIRMISH_BUILD_STRUCTURE_FRONT'],
  [461, 'SKIRMISH_BUILD_STRUCTURE_FLANK'],
  [462, 'SKIRMISH_ATTACK_NEAREST_GROUP_WITH_VALUE'],
  [463, 'SKIRMISH_PERFORM_COMMANDBUTTON_ON_MOST_VALUABLE_OBJECT'],
  [464, 'SKIRMISH_WAIT_FOR_COMMANDBUTTON_AVAILABLE_ALL'],
  [465, 'SKIRMISH_WAIT_FOR_COMMANDBUTTON_AVAILABLE_PARTIAL'],
  [466, 'TEAM_SPIN_FOR_FRAMECOUNT'],
  [467, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NAMED'],
  [468, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_ENEMY_UNIT'],
  [469, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_GARRISONED_BUILDING'],
  [470, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_KINDOF'],
  [471, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_ENEMY_BUILDING'],
  [472, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_ENEMY_BUILDING_CLASS'],
  [473, 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_OBJECTTYPE'],
  [474, 'TEAM_PARTIAL_USE_COMMANDBUTTON'],
  [475, 'TEAM_CAPTURE_NEAREST_UNOWNED_FACTION_UNIT'],
  [476, 'PLAYER_CREATE_TEAM_FROM_CAPTURED_UNITS'],
  [484, 'TEAM_WAIT_FOR_NOT_CONTAINED_ALL'],
  [485, 'TEAM_WAIT_FOR_NOT_CONTAINED_PARTIAL'],
  [486, 'TEAM_FOLLOW_WAYPOINTS_EXACT'],
  [487, 'NAMED_FOLLOW_WAYPOINTS_EXACT'],
  [488, 'TEAM_SET_EMOTICON'],
  [489, 'NAMED_SET_EMOTICON'],
  [494, 'MAP_REVEAL_PERMANENTLY_AT_WAYPOINT'],
  [495, 'MAP_UNDO_REVEAL_PERMANENTLY_AT_WAYPOINT'],
  [496, 'NAMED_SET_STEALTH_ENABLED'],
  [497, 'TEAM_SET_STEALTH_ENABLED'],
  [498, 'EVA_SET_ENABLED_DISABLED'],
  [499, 'OPTIONS_SET_OCCLUSION_MODE'],
  [500, 'OPTIONS_SET_DRAWICON_UI_MODE'],
  [502, 'OPTIONS_SET_PARTICLE_CAP_MODE'],
  [504, 'UNIT_AFFECT_OBJECT_PANEL_FLAGS'],
  [505, 'TEAM_AFFECT_OBJECT_PANEL_FLAGS'],
  [506, 'PLAYER_SELECT_SKILLSET'],
  [507, 'SCRIPTING_OVERRIDE_HULK_LIFETIME'],
  [508, 'NAMED_FACE_NAMED'],
  [509, 'NAMED_FACE_WAYPOINT'],
  [510, 'TEAM_FACE_NAMED'],
  [511, 'TEAM_FACE_WAYPOINT'],
  [512, 'COMMANDBAR_REMOVE_BUTTON_OBJECTTYPE'],
  [513, 'COMMANDBAR_ADD_BUTTON_OBJECTTYPE_SLOT'],
  [514, 'UNIT_SPAWN_NAMED_LOCATION_ORIENTATION'],
  [515, 'PLAYER_AFFECT_RECEIVING_EXPERIENCE'],
  [516, 'PLAYER_EXCLUDE_FROM_SCORE_SCREEN'],
  [517, 'TEAM_GUARD_SUPPLY_CENTER'],
  [518, 'ENABLE_SCORING'],
  [519, 'DISABLE_SCORING'],
  [520, 'SOUND_SET_VOLUME'],
  [521, 'SPEECH_SET_VOLUME'],
  [522, 'DISABLE_BORDER_SHROUD'],
  [523, 'ENABLE_BORDER_SHROUD'],
  [524, 'OBJECT_ALLOW_BONUSES'],
  [525, 'SOUND_REMOVE_ALL_DISABLED'],
  [526, 'SOUND_REMOVE_TYPE'],
  [527, 'TEAM_GUARD_IN_TUNNEL_NETWORK'],
  [528, 'QUICKVICTORY'],
  [529, 'SET_INFANTRY_LIGHTING_OVERRIDE'],
  [530, 'RESET_INFANTRY_LIGHTING_OVERRIDE'],
  [542, 'NAMED_USE_COMMANDBUTTON_ABILITY_USING_WAYPOINT_PATH'],
]);

const SCRIPT_ACTION_TYPE_NAME_SET = new Set<string>(SCRIPT_ACTION_TYPE_NUMERIC_TO_NAME.values());

const SCRIPT_ACTION_TYPE_ALIASES = new Map<string, string>([
  ['ADD_TO_TIMER', 'ADD_TO_MSEC_TIMER'],
  ['SUB_FROM_TIMER', 'SUB_FROM_MSEC_TIMER'],
]);

/**
 * Source parity: additional action names that currently arrive through numeric-id remapping
 * collisions in map script chunks (ScriptAction::ParseAction + ActionTemplate internal names).
 */
const SCRIPT_ACTION_TYPE_EXTRA_NAMES = new Set<string>([
  'TEAM_DELETE_LIVING',
  'RESIZE_VIEW_GUARDBAND',
  'DELETE_ALL_UNMANNED',
  'CHOOSE_VICTIM_ALWAYS_USES_NORMAL',
  'AI_PLAYER_BUILD_SUPPLY_CENTER',
  'AI_PLAYER_BUILD_UPGRADE',
  'AI_PLAYER_BUILD_TYPE_NEAREST_TEAM',
  'CAMERA_ENABLE_SLAVE_MODE',
  'CAMERA_DISABLE_SLAVE_MODE',
  'CAMERA_ADD_SHAKER_AT',
  'SET_TRAIN_HELD',
  'NAMED_SET_UNMANNED_STATUS',
  'TEAM_SET_UNMANNED_STATUS',
  'NAMED_SET_BOOBYTRAPPED',
  'TEAM_SET_BOOBYTRAPPED',
  'CAMERA_MOD_LOOK_TOWARD',
  'DEBUG_CRASH_BOX',
  'CREATE_REINFORCEMENT_TEAM',
]);

// ---- Script action implementations ----

export function readScriptDictString(self: GL, dict: Record<string, unknown>, key: string): string {
  const value = dict[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  return '';
}

export function readScriptDictNumber(self: GL, dict: Record<string, unknown>, key: string): number | null {
  const value = dict[key];
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function readScriptDictBoolean(self: GL, dict: Record<string, unknown>, key: string): boolean | null {
  const value = dict[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (!normalized) {
      return null;
    }
    if (normalized === 'TRUE' || normalized === 'YES' || normalized === 'ON' || normalized === '1') {
      return true;
    }
    if (normalized === 'FALSE' || normalized === 'NO' || normalized === 'OFF' || normalized === '0') {
      return false;
    }
  }
  return null;
}

export function resolveScriptTeamTemplateUnitEntries(self: GL, 
  dict: Record<string, unknown>,
): ScriptTeamTemplateUnitEntry[] {
  const entries: ScriptTeamTemplateUnitEntry[] = [];
  for (let slot = 1; slot <= 7; slot += 1) {
    const templateName = readScriptDictString(self, dict, `teamUnitType${slot}`).trim();
    if (!templateName) {
      continue;
    }
    const maxUnitsValue = readScriptDictNumber(self, dict, `teamUnitMaxCount${slot}`);
    if (maxUnitsValue === null || !Number.isFinite(maxUnitsValue)) {
      continue;
    }
    const maxUnits = Math.trunc(maxUnitsValue);
    if (maxUnits <= 0) {
      continue;
    }
    const minUnitsValue = readScriptDictNumber(self, dict, `teamUnitMinCount${slot}`);
    const minUnits = minUnitsValue === null || !Number.isFinite(minUnitsValue)
      ? 0
      : Math.max(0, Math.trunc(minUnitsValue));
    entries.push({
      templateName,
      minUnits,
      maxUnits,
    });
  }
  return entries;
}

export function resolveScriptSideFromPlayerFaction(self: GL, playerFaction: string): string | null {
  const trimmed = playerFaction.trim();
  if (!trimmed) {
    return null;
  }
  const registry = self.iniDataRegistry;
  const factionDef = registry ? registry.getFaction(trimmed) : undefined;
  if (factionDef?.side) {
    return self.normalizeSide(factionDef.side);
  }
  const normalized = self.normalizeSide(trimmed);
  return normalized || null;
}

export function resolveScriptAiBuildListEntries(self: GL, 
  buildList: readonly MapSideBuildListEntryJSON[],
): ScriptAiBuildListEntry[] {
  const registry = self.iniDataRegistry;
  if (!registry || buildList.length === 0) {
    return [];
  }

  const entries: ScriptAiBuildListEntry[] = [];
  for (const entry of buildList) {
    const templateName = entry.templateName?.trim();
    if (!templateName) {
      continue;
    }
    const objectDef = findObjectDefByName(registry, templateName);
    if (!objectDef) {
      continue;
    }
    entries.push({
      templateNameUpper: objectDef.name.trim().toUpperCase(),
      locationX: Number.isFinite(entry.location.x) ? entry.location.x : 0,
      // Source parity: map build-list Coord3D y maps to world Z in this port.
      locationZ: Number.isFinite(entry.location.y) ? entry.location.y : 0,
    });
  }
  return entries;
}

export function normalizeScriptKindOfToken(self: GL, rawValue: string): string | null {
  const token = rawValue.trim().toUpperCase();
  if (!token) {
    return null;
  }
  const normalized = token.startsWith('KINDOF_') ? token.slice('KINDOF_'.length) : token;
  if (normalized === 'CRUSHER' || normalized === 'CRUSHABLE' || normalized === 'OVERLAPPABLE') {
    return 'OBSTACLE';
  }
  if (normalized === 'MISSILE') {
    return 'SMALL_MISSILE';
  }
  return normalized;
}

export function resolveScriptKindOfBitFromName(self: GL, kindOfName: string): number | null {
  const direct = self.scriptKindOfNameToBit.get(kindOfName);
  if (direct !== undefined) {
    return direct;
  }

  const alternate = self.scriptKindOfNamesBySourceBit === SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT
    ? SCRIPT_KIND_OF_NAME_TO_BIT_ALLOW_SURRENDER.get(kindOfName)
    : SCRIPT_KIND_OF_NAME_TO_BIT.get(kindOfName);
  return alternate ?? null;
}

export function resolveScriptKindOfNameFromSourceBit(self: GL, kindOfBit: number): string | null {
  if (!Number.isFinite(kindOfBit)) {
    return null;
  }
  const normalizedBit = Math.trunc(kindOfBit);
  if (normalizedBit < 0) {
    return null;
  }

  const direct = self.scriptKindOfNamesBySourceBit[normalizedBit] ?? null;
  if (direct) {
    return direct;
  }

  const alternate = self.scriptKindOfNamesBySourceBit === SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT
    ? SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT_ALLOW_SURRENDER[normalizedBit] ?? null
    : SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT[normalizedBit] ?? null;
  return alternate;
}

export function clearScriptUIInteractions(self: GL): void {
  self.scriptUIInteractions.clear();
}

export function getScriptCreditsForPlayerInput(self: GL, sideInput: string): number {
  const selector = resolveScriptPlayerConditionSelector(self, sideInput);
  if (selector.explicitNamedPlayer && selector.controllingPlayerToken) {
    const namedCredits = self.controllingPlayerScriptCredits.get(selector.controllingPlayerToken);
    if (namedCredits !== undefined) {
      return namedCredits;
    }
  }
  const normalizedSide = selector.normalizedSide;
  if (!normalizedSide) {
    return 0;
  }
  return self.getSideCredits(normalizedSide);
}

export function countScriptPlayersForSide(self: GL, normalizedSide: string): number {
  let count = 0;
  for (const side of self.scriptPlayerSideByName.values()) {
    if (side === normalizedSide) {
      count += 1;
    }
  }
  return count;
}

export function setScriptCreditsForPlayerInput(self: GL, sideInput: string, amount: number): boolean {
  const selector = resolveScriptPlayerConditionSelector(self, sideInput);
  const normalizedSide = selector.normalizedSide;
  if (!normalizedSide || !Number.isFinite(amount)) {
    return false;
  }
  const normalizedAmount = Math.max(0, Math.trunc(amount));
  if (selector.explicitNamedPlayer && selector.controllingPlayerToken) {
    self.controllingPlayerScriptCredits.set(selector.controllingPlayerToken, normalizedAmount);
    if (countScriptPlayersForSide(self, normalizedSide) <= 1) {
      self.setSideCredits(normalizedSide, normalizedAmount);
    }
    return true;
  }
  self.setSideCredits(normalizedSide, normalizedAmount);
  return true;
}

export function setScriptLocalGameEndState(self: GL, localDefeated: boolean, durationFrames: number): boolean {
  const boundedDuration = Math.max(1, Math.trunc(durationFrames));
  const localSide = self.resolveLocalPlayerSide();
  if (localSide) {
    if (localDefeated) {
      self.defeatedSides.add(localSide);
    } else {
      self.defeatedSides.delete(localSide);
    }
  }
  self.scriptEndGameTimerActive = true;
  self.setScriptInputDisabled(true);
  self.gameEndFrame = self.frameCounter + boundedDuration;
  return true;
}

/**
 * Source parity: ScriptActions::doLocalDefeat — UI-only notification action.
 * In C++ this shows a LocalDefeat.wnd dialog and starts a close-window timer
 * but does NOT mark the player as defeated in the victory-conditions sense
 * and does NOT set the end-game timer.  Campaign intro cinematics use this
 * action to signal "you aren't in control yet" without ending the game.
 */
export function setScriptLocalDefeatState(self: GL): boolean {
  // Source parity: doLocalDefeat only calls startCloseWindowTimer (UI),
  // NOT startEndGameTimer.  It does NOT add the player to defeatedSides.
  void self;
  return true;
}

export function applyScriptStoppingDistanceToEntity(self: GL, entity: MapEntity, stoppingDistance: number): boolean {
  if (!entity.canMove || entity.locomotorSets.size === 0) {
    return false;
  }
  if (!Number.isFinite(stoppingDistance) || stoppingDistance < 0.5) {
    return true;
  }
  entity.scriptStoppingDistanceOverride = stoppingDistance;
  return true;
}

export function executeScriptNamedSetStoppingDistance(self: GL, entityId: number, stoppingDistance: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  return applyScriptStoppingDistanceToEntity(self, entity, stoppingDistance);
}

export function executeScriptSetStoppingDistance(self: GL, teamName: string, stoppingDistance: number): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    // Source parity: return immediately when encountering a member without an active locomotor.
    if (!applyScriptStoppingDistanceToEntity(self, entity, stoppingDistance)) {
      return true;
    }
  }
  return true;
}

export function enqueueScriptPopupMessage(self: GL, 
  message: string,
  x: number,
  y: number,
  width: number,
  pause: boolean,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width)) {
    return false;
  }
  self.scriptPopupMessages.push({
    message,
    x: Math.trunc(x),
    y: Math.trunc(y),
    width: Math.trunc(width),
    pause,
    frame: self.frameCounter,
  });
  return true;
}

export function enqueueScriptDisplayText(self: GL, displayText: string): boolean {
  const normalizedText = displayText.trim();
  if (!normalizedText) {
    return false;
  }
  self.scriptDisplayMessages.push({
    messageType: 'DISPLAY_TEXT',
    text: normalizedText,
    duration: null,
    frame: self.frameCounter,
  });
  return true;
}

export function enqueueScriptMilitaryCaption(self: GL, captionText: string, duration: number): boolean {
  if (!Number.isFinite(duration)) {
    return false;
  }
  const normalizedText = captionText.trim();
  if (!normalizedText) {
    return false;
  }
  self.scriptDisplayMessages.push({
    messageType: 'MILITARY_CAPTION',
    text: normalizedText,
    duration: Math.trunc(duration),
    frame: self.frameCounter,
  });
  return true;
}

export function setScriptDisplayedCounter(self: GL, counterName: string, counterText: string, isCountdown: boolean): boolean {
  const normalizedName = normalizeScriptVariableName(self, counterName);
  if (!normalizedName) {
    return false;
  }
  self.scriptDisplayedCounters.set(normalizedName, {
    counterName: normalizedName,
    counterText,
    isCountdown,
    frame: self.frameCounter,
  });
  return true;
}

export function hideScriptDisplayedCounter(self: GL, counterName: string): boolean {
  const normalizedName = normalizeScriptVariableName(self, counterName);
  if (!normalizedName) {
    return false;
  }
  self.scriptDisplayedCounters.delete(normalizedName);
  return true;
}

export function setScriptNamedTimerDisplayEnabled(self: GL, enabled: boolean): void {
  self.scriptNamedTimerDisplayEnabled = enabled;
}

export function setScriptSpecialPowerDisplayEnabled(self: GL, enabled: boolean): void {
  self.scriptSpecialPowerDisplayEnabled = enabled;
}

export function setScriptNamedSpecialPowerDisplayHidden(self: GL, entityId: number, hidden: boolean): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  if (hidden) {
    self.scriptHiddenSpecialPowerDisplayEntityIds.add(entity.id);
  } else {
    self.scriptHiddenSpecialPowerDisplayEntityIds.delete(entity.id);
  }
  return true;
}

export function setScriptMusicTrack(self: GL, trackName: string, fadeOut: boolean, fadeIn: boolean): boolean {
  const normalizedTrackName = normalizeScriptAudioEventName(self, trackName);
  if (!normalizedTrackName) {
    return false;
  }
  clearScriptMusicCompletionState(self, normalizedTrackName);
  self.scriptMusicTrackState = {
    trackName: normalizedTrackName,
    fadeOut,
    fadeIn,
    frame: self.frameCounter,
  };
  return true;
}

export function setScriptVisualSpeedMultiplier(self: GL, multiplier: number): boolean {
  if (!Number.isFinite(multiplier)) {
    return false;
  }
  self.scriptVisualSpeedMultiplier = Math.trunc(multiplier);
  return true;
}

export function setScriptHulkLifetimeOverrideSeconds(self: GL, seconds: number): boolean {
  if (!Number.isFinite(seconds)) {
    return false;
  }
  if (seconds < 0) {
    self.scriptHulkLifetimeOverrideFrames = -1;
    return true;
  }
  self.scriptHulkLifetimeOverrideFrames = Math.trunc(seconds * LOGIC_FRAME_RATE);
  return true;
}

export function setScriptInfantryLightingOverride(self: GL, setting: number): boolean {
  if (!Number.isFinite(setting)) {
    return false;
  }
  if (setting !== -1 && setting <= 0) {
    return false;
  }
  self.scriptInfantryLightingOverride = setting;
  return true;
}

export function executeScriptSetTreeSway(self: GL, 
  direction: number,
  intensity: number,
  lean: number,
  breezePeriodFrames: number,
  randomness: number,
): boolean {
  if (
    !Number.isFinite(direction)
    || !Number.isFinite(intensity)
    || !Number.isFinite(lean)
    || !Number.isFinite(breezePeriodFrames)
    || !Number.isFinite(randomness)
  ) {
    return false;
  }

  self.scriptBreezeState.version += 1;
  self.scriptBreezeState.direction = direction;
  self.scriptBreezeState.directionX = Math.sin(direction);
  self.scriptBreezeState.directionY = Math.cos(direction);
  self.scriptBreezeState.intensity = intensity;
  self.scriptBreezeState.lean = lean;
  self.scriptBreezeState.breezePeriodFrames = Math.max(1, Math.trunc(breezePeriodFrames));
  self.scriptBreezeState.randomness = randomness;
  return true;
}

export function executeScriptDebugMessage(self: GL, 
  message: string,
  crashRequested: boolean,
  pauseRequested: boolean,
): boolean {
  self.scriptDebugMessageRequests.push({
    message,
    crashRequested,
    pauseRequested,
    frame: self.frameCounter,
  });
  return true;
}

export function executeScriptNamedSetEmoticon(self: GL, 
  entityId: number,
  emoticonName: string,
  durationSeconds: number,
): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }

  const durationFrames = Math.trunc(durationSeconds * LOGIC_FRAME_RATE);
  self.scriptEmoticonRequests.push({
    entityId: entity.id,
    emoticonName,
    durationFrames,
    frame: self.frameCounter,
  });
  return true;
}

export function executeScriptTeamSetEmoticon(self: GL, 
  teamName: string,
  emoticonName: string,
  durationSeconds: number,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const durationFrames = Math.trunc(durationSeconds * LOGIC_FRAME_RATE);
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    self.scriptEmoticonRequests.push({
      entityId: entity.id,
      emoticonName,
      durationFrames,
      frame: self.frameCounter,
    });
  }
  return true;
}

export function normalizeScriptAudioEventName(self: GL, eventName: string): string {
  return eventName.trim();
}

export function executeScriptSetCaveIndex(self: GL, entityId: number, caveIndex: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }

  const containProfile = entity.containProfile;
  if (!containProfile || containProfile.moduleType !== 'CAVE') {
    return false;
  }

  if (!Number.isFinite(caveIndex)) {
    return false;
  }
  const newIndex = Math.trunc(caveIndex);
  if (newIndex < 0) {
    return false;
  }

  const oldIndex = self.caveTrackerIndexByEntityId.get(entity.id) ?? containProfile.caveIndex ?? 0;
  if (!self.canSwitchCaveIndexToIndex(oldIndex, newIndex)) {
    return false;
  }

  const oldTracker = self.unregisterTunnelEntity(entity);
  if (oldTracker) {
    self.removeTunnelNodeFromTracker(entity, oldTracker);
  }

  containProfile.caveIndex = newIndex;
  const newTracker = self.resolveCaveTracker(newIndex);
  if (!newTracker) {
    return false;
  }

  self.caveTrackerIndexByEntityId.set(entity.id, newIndex);
  newTracker.tunnelIds.add(entity.id);
  return true;
}

export function setScriptNamedToppleDirection(self: GL, entityId: number, dirX: number, dirZ: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  if (!Number.isFinite(dirX) || !Number.isFinite(dirZ)) {
    return false;
  }
  self.scriptToppleDirectionByEntityId.set(entityId, {
    x: dirX,
    z: dirZ,
  });
  return true;
}

export function pruneExpiredScriptRadarEvents(self: GL): void {
  if (self.scriptRadarEvents.length === 0) {
    return;
  }
  for (let index = self.scriptRadarEvents.length - 1; index >= 0; index -= 1) {
    const event = self.scriptRadarEvents[index];
    if (!event || event.expireFrame > self.frameCounter) {
      continue;
    }
    self.scriptRadarEvents.splice(index, 1);
  }
}

export function recordScriptRadarEvent(self: GL, 
  x: number,
  y: number,
  z: number,
  eventType: number,
  sourceEntityId: number | null,
  sourceTeamName: string | null,
): void {
  pruneExpiredScriptRadarEvents(self);

  if (self.scriptRadarEvents.length >= MAX_SCRIPT_RADAR_EVENTS) {
    self.scriptRadarEvents.shift();
  }

  const state: ScriptRadarEventState = {
    x,
    y,
    z,
    eventType: Math.trunc(eventType),
    frame: self.frameCounter,
    expireFrame: self.frameCounter + SCRIPT_RADAR_EVENT_TTL_FRAMES,
    sourceEntityId,
    sourceTeamName,
  };
  self.scriptRadarEvents.push(state);
  if (state.eventType !== RADAR_EVENT_BEACON_PULSE) {
    self.scriptLastRadarEventState = state;
  }
}

export function executeScriptAction(self: GL, action: unknown): boolean {
  if (!action || typeof action !== 'object') {
    return false;
  }

  const actionRecord = action as Record<string, unknown>;
  const { paramsObject, paramsArray } = resolveScriptConditionParams(self, actionRecord);
  const rawActionType = actionRecord.actionType ?? actionRecord.type;
  let actionType = resolveScriptActionTypeName(self, rawActionType);
  if (typeof rawActionType === 'number' && Number.isFinite(rawActionType)) {
    const numericType = Math.trunc(rawActionType);
    const paramCount = paramsArray.length > 0
      ? paramsArray.length
      : (paramsObject ? Object.keys(paramsObject).length : 0);

    // Source parity: Script chunks may collide on numeric id 291 across script-set variants.
    // ScriptAction::ParseAction rematches by internal-name key; without that key we disambiguate
    // by signature (2 params => NAMED_SET_STEALTH_ENABLED, 3 params => PLAYER_RELATES_PLAYER).
    if (numericType === 212 && paramCount === 1) {
      // 212 also maps to WAREHOUSE_SET_VALUE in another script set; 1-param signature is sound effect.
      actionType = 'PLAY_SOUND_EFFECT';
    } else if (numericType === 32 && paramCount === 1) {
      // 32 also maps to TEAM_ATTACK_TEAM in another script set; 1-param signature is camera-mod look toward.
      actionType = 'CAMERA_MOD_LOOK_TOWARD';
    } else if (numericType === 216 && paramCount === 1) {
      // 216 also maps to PLAY_SOUND_EFFECT_AT in another script set; 1-param signature is debug crash box.
      actionType = 'DEBUG_CRASH_BOX';
    } else if (numericType === 219 && paramCount === 5) {
      // 219 also maps to SOUND_ENABLE_ALL in another script set; 5-param signature is camera move.
      actionType = 'MOVE_CAMERA_TO';
    } else if (numericType === 222 && paramCount === 5) {
      // 222 also maps to AUDIO_RESTORE_VOLUME_ALL_TYPE; 5-param signature is waypoint-path camera move.
      actionType = 'MOVE_CAMERA_ALONG_WAYPOINT_PATH';
    } else if (numericType === 223 && paramCount === 4) {
      // 223 also maps to INGAME_POPUP_MESSAGE; 4-param signature is camera rotation.
      actionType = 'ROTATE_CAMERA';
    } else if (numericType === 224 && paramCount === 4) {
      // 224 also maps to SET_CAVE_INDEX; 4-param signature is camera reset.
      actionType = 'RESET_CAMERA';
    } else if (numericType === 229 && paramCount === 0) {
      // 229 also maps to MAP_REVEAL_ALL_PERM; 0-param signature is background sound pause.
      actionType = 'SUSPEND_BACKGROUND_SOUNDS';
    } else if (numericType === 230 && paramCount === 0) {
      // 230 also maps to MAP_REVEAL_ALL_UNDO_PERM; 0-param signature is background sound resume.
      actionType = 'RESUME_BACKGROUND_SOUNDS';
    } else if (numericType === 241 && paramCount === 2) {
      // 241 also maps to TEAM_FOLLOW_WAYPOINTS in another script set; 2-param signature is reinforcements.
      actionType = 'CREATE_REINFORCEMENT_TEAM';
    } else if (numericType === 281 && paramCount === 1) {
      // 281 also maps to TEAM_FOLLOW_WAYPOINTS_EXACT; 1-param signature is display text.
      actionType = 'DISPLAY_TEXT';
    } else if (numericType === 285 && paramCount === 3) {
      // 285 also maps to MOVIE_PLAY_FULLSCREEN; 3-param signature is AI player build by supplies.
      actionType = 'AI_PLAYER_BUILD_SUPPLY_CENTER';
    } else if (numericType === 286 && paramCount === 2) {
      // 286 also maps to MOVIE_PLAY_RADAR; 2-param signature is AI player build upgrade.
      actionType = 'AI_PLAYER_BUILD_UPGRADE';
    } else if (numericType === 319 && paramCount === 4) {
      // 319 also maps to SOUND_REMOVE_ALL_DISABLED; 4-param signature is setup camera.
      actionType = 'SETUP_CAMERA';
    } else if (numericType === 322 && paramCount === 4) {
      // 322 also maps to TEAM_GUARD_IN_TUNNEL_NETWORK; 4-param signature is zoom camera.
      actionType = 'ZOOM_CAMERA';
    } else if (numericType === 323 && paramCount === 4) {
      // 323 also maps to QUICKVICTORY/TEAM_GUARD_IN_TUNNEL_NETWORK; 4-param signature is pitch camera.
      actionType = 'PITCH_CAMERA';
    } else if (numericType === 324 && paramCount === 2) {
      // 324 also maps to QUICKVICTORY; 2-param signature is camera follow named.
      actionType = 'CAMERA_FOLLOW_NAMED';
    } else if (numericType === 326 && paramCount === 1) {
      // 326 also maps to CAMERA_FADE_ADD in another script set; 1-param signature is team delete living.
      actionType = 'TEAM_DELETE_LIVING';
    } else if (numericType === 327 && paramCount === 2) {
      // 327 also maps to CAMERA_FADE_SUBTRACT in another script set; 2-param signature is resize view guardband.
      actionType = 'RESIZE_VIEW_GUARDBAND';
    } else if (numericType === 328 && paramCount === 0) {
      // 328 also maps to CAMERA_FADE_SATURATE in another script set; 0-param signature is delete all unmanned.
      actionType = 'DELETE_ALL_UNMANNED';
    } else if (numericType === 329 && paramCount === 1) {
      // 329 also maps to CAMERA_FADE_MULTIPLY in another script set; 1-param signature is choose victim always uses normal.
      actionType = 'CHOOSE_VICTIM_ALWAYS_USES_NORMAL';
    } else if (numericType === 330 && paramCount === 2) {
      // 330 also maps to CAMERA_BW_MODE_BEGIN in another script set; 2-param signature is camera enable slave mode.
      actionType = 'CAMERA_ENABLE_SLAVE_MODE';
    } else if (numericType === 331 && paramCount === 0) {
      // 331 also maps to CAMERA_BW_MODE_END in another script set; 0-param signature is camera disable slave mode.
      actionType = 'CAMERA_DISABLE_SLAVE_MODE';
    } else if (numericType === 332 && paramCount === 4) {
      // 332 also maps to DRAW_SKYBOX_BEGIN in another script set; 4-param signature is camera add shaker.
      actionType = 'CAMERA_ADD_SHAKER_AT';
    } else if (numericType === 333 && paramCount === 2) {
      // 333 also maps to DRAW_SKYBOX_END in another script set; 2-param signature is set train held.
      actionType = 'SET_TRAIN_HELD';
    } else if (numericType === 303 && paramCount === 0) {
      // 303 also maps to NAMED_FACE_NAMED; 0-param signature is ambient sound resume.
      actionType = 'SOUND_AMBIENT_RESUME';
    } else if (numericType === 304 && paramCount === 3) {
      // 304 also maps to NAMED_FACE_WAYPOINT; 3-param signature is music track change.
      actionType = 'MUSIC_SET_TRACK';
    } else if (numericType === 307 && paramCount === 1) {
      // 307 also maps to COMMANDBAR_REMOVE_BUTTON_OBJECTTYPE; 1-param signature is map reveal all.
      actionType = 'MAP_REVEAL_ALL';
    } else if (numericType === 337 && paramCount === 0) {
      // 337 also maps to NAMED_USE_COMMANDBUTTON_ABILITY_USING_WAYPOINT_PATH; 0-param signature is camera stop follow.
      actionType = 'CAMERA_STOP_FOLLOW';
    } else if (numericType === 338 && paramCount === 1) {
      // 338 also maps to CAMERA_MOTION_BLUR in another script set; 1-param signature is named set unmanned.
      actionType = 'NAMED_SET_UNMANNED_STATUS';
    } else if (numericType === 339 && paramCount === 1) {
      // 339 also maps to CAMERA_MOTION_BLUR_JUMP in another script set; 1-param signature is team set unmanned.
      actionType = 'TEAM_SET_UNMANNED_STATUS';
    } else if (numericType === 340 && paramCount === 2) {
      // 340 also maps to CAMERA_MOTION_BLUR_FOLLOW in another script set; 2-param signature is named set boobytrapped.
      actionType = 'NAMED_SET_BOOBYTRAPPED';
    } else if (numericType === 341 && paramCount === 2) {
      // 341 also maps to CAMERA_MOTION_BLUR_END_FOLLOW in another script set; 2-param signature is team set boobytrapped.
      actionType = 'TEAM_SET_BOOBYTRAPPED';
    } else if (numericType === 342 && paramCount === 0) {
      // 342 also maps to SHOW_WEATHER; 0-param signature is FREEZE_TIME from offset script-set ids.
      actionType = 'FREEZE_TIME';
    } else if (numericType === 343 && paramCount === 3) {
      // 343 also maps to UNFREEZE_TIME; 3-param signature is AI player build nearest team.
      actionType = 'AI_PLAYER_BUILD_TYPE_NEAREST_TEAM';
    } else if (numericType === 348 && paramCount === 1) {
      // 348 also maps to PLAYER_SET_MONEY; 1-param signature is FPS limit.
      actionType = 'SET_FPS_LIMIT';
    } else if (numericType === 350 && paramCount === 3) {
      // 350 also maps to PLAYER_GIVE_MONEY; 3-param signature is map shroud at waypoint.
      actionType = 'MAP_SHROUD_AT_WAYPOINT';
    } else if (numericType === 321 && paramCount === 0) {
      // 321 also maps to SOUND_REMOVE_TYPE; 0-param signature is letterbox end.
      actionType = 'CAMERA_LETTERBOX_END';
    } else if (numericType === 291 && paramCount === 2) {
      actionType = 'NAMED_SET_STEALTH_ENABLED';
    } else if (numericType === 293 && paramCount === 1) {
      // 293 also maps to RADAR_DISABLE in another script set; 1-param signature is EVA toggle.
      actionType = 'EVA_SET_ENABLED_DISABLED';
    } else if (numericType === 294 && paramCount === 1) {
      // 294 also maps to RADAR_ENABLE in another script set; 1-param signature is occlusion toggle.
      actionType = 'OPTIONS_SET_OCCLUSION_MODE';
    } else if (numericType === 295 && paramCount === 3) {
      // 295 also maps to OPTIONS_SET_DRAWICON_UI_MODE; 3-param signature is map reveal at waypoint.
      actionType = 'MAP_REVEAL_AT_WAYPOINT';
    } else if (numericType === 299 && paramCount === 3) {
      // 299 also maps to DISABLE_INPUT in another script set; 3-param signature is unit panel flags.
      actionType = 'UNIT_AFFECT_OBJECT_PANEL_FLAGS';
    } else if (numericType === 300 && paramCount === 3) {
      // 300 also maps to ENABLE_INPUT in another script set; 3-param signature is team panel flags.
      actionType = 'TEAM_AFFECT_OBJECT_PANEL_FLAGS';
    } else if (numericType === 323 && paramCount === 1) {
      // Source-script variants may serialize TEAM_GUARD_IN_TUNNEL_NETWORK as 323.
      actionType = 'TEAM_GUARD_IN_TUNNEL_NETWORK';
    }
  }
  if (!actionType) {
    return false;
  }

  const readValue = (index: number, keyNames: readonly string[] = []): unknown =>
    resolveScriptConditionParamValue(self, actionRecord, paramsObject, paramsArray, index, keyNames);
  const readString = (index: number, keyNames: readonly string[] = []): string =>
    coerceScriptConditionString(self, readValue(index, keyNames));
  const readSide = (index: number, keyNames: readonly string[] = []): string =>
    resolveScriptPlayerSideFromInput(self, readString(index, keyNames)) ?? '';
  const readNumber = (index: number, keyNames: readonly string[] = []): number =>
    coerceScriptConditionNumber(self, readValue(index, keyNames)) ?? 0;
  const readInteger = (index: number, keyNames: readonly string[] = []): number =>
    Math.trunc(readNumber(index, keyNames));
  const readEntityId = (index: number, keyNames: readonly string[] = []): number => {
    const value = readValue(index, keyNames);
    const resolved = resolveScriptEntityId(self, value);
    if (resolved !== null) {
      return resolved;
    }
    const fallback = coerceScriptConditionNumber(self, value);
    return fallback === null ? 0 : Math.trunc(fallback);
  };
  const readBoolean = (index: number, keyNames: readonly string[] = []): boolean =>
    coerceScriptConditionBoolean(self, readValue(index, keyNames), false);
  const readRelationship = (
    index: number,
    keyNames: readonly string[] = [],
  ): ScriptRelationshipInput => {
    const value = readValue(index, keyNames);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    return coerceScriptConditionString(self, value) as ScriptRelationshipInput;
  };

  switch (actionType) {
    case 'NO_OP':
      return true;
    case 'DAMAGE_MEMBERS_OF_TEAM':
      return executeScriptDamageMembersOfTeam(self, 
        readString(0, ['teamName', 'team']),
        readNumber(1, ['damageAmount', 'damage', 'amount']),
      );
    case 'MOVE_TEAM_TO':
      return executeScriptMoveTeamToWaypoint(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['waypointName', 'waypoint']),
      );
    case 'MOVE_NAMED_UNIT_TO':
      return executeScriptMoveNamedUnitToWaypoint(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'unitName']),
        readString(1, ['waypointName', 'waypoint']),
      );
    case 'TEAM_ATTACK_TEAM':
      return executeScriptTeamAttackTeam(self, 
        readString(0, ['attackerTeamName', 'sourceTeamName', 'teamName', 'team']),
        readString(1, ['victimTeamName', 'targetTeamName', 'otherTeam']),
      );
    case 'NAMED_ATTACK_NAMED':
      return executeScriptNamedAttackNamed(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'attackerEntityId', 'attackerUnitId']),
        readEntityId(1, ['targetEntityId', 'otherEntityId', 'victimEntityId', 'targetUnitId']),
      );
    case 'NAMED_ATTACK_AREA':
      return executeScriptNamedAttackArea(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'attackerEntityId', 'attackerUnitId']),
        readString(1, ['triggerName', 'trigger', 'areaName', 'area']),
      );
    case 'NAMED_ATTACK_TEAM':
      return executeScriptNamedAttackTeam(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'attackerEntityId', 'attackerUnitId']),
        readString(1, ['victimTeamName', 'targetTeamName', 'teamName', 'team']),
      );
    case 'TEAM_ATTACK_AREA':
      return executeScriptTeamAttackArea(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['triggerName', 'trigger', 'areaName', 'area']),
      );
    case 'TEAM_ATTACK_NAMED':
      return executeScriptTeamAttackNamed(self, 
        readString(0, ['attackerTeamName', 'sourceTeamName', 'teamName', 'team']),
        readEntityId(1, ['targetEntityId', 'entityId', 'victimEntityId', 'targetUnitId', 'named']),
      );
    case 'TEAM_LOAD_TRANSPORTS':
      return executeScriptTeamLoadTransports(self, 
        readString(0, ['teamName', 'team']),
      );
    case 'NAMED_HUNT':
      return executeScriptNamedHunt(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'unitName']),
      );
    case 'TEAM_HUNT':
      return executeScriptTeamHunt(self, 
        readString(0, ['teamName', 'team']),
      );
    case 'PLAYER_HUNT':
      return executeScriptPlayerHunt(self, 
        readSide(0, ['side', 'playerName', 'player']),
      );
    case 'PLAYER_SELL_EVERYTHING':
      return executeScriptPlayerSellEverything(self, 
        readSide(0, ['side', 'playerName', 'player']),
      );
    case 'PLAYER_DISABLE_BASE_CONSTRUCTION':
      return executeScriptPlayerSetBaseConstructionEnabled(self, 
        readSide(0, ['side', 'playerName', 'player']),
        false,
      );
    case 'PLAYER_DISABLE_FACTORIES':
      return executeScriptPlayerSetObjectTemplateEnabled(self, 
        readSide(0, ['side', 'playerName', 'player']),
        readString(1, ['templateName', 'objectType', 'object', 'thingTemplate']),
        false,
      );
    case 'PLAYER_DISABLE_UNIT_CONSTRUCTION':
      return executeScriptPlayerSetUnitConstructionEnabled(self, 
        readSide(0, ['side', 'playerName', 'player']),
        false,
      );
    case 'PLAYER_ENABLE_BASE_CONSTRUCTION':
      return executeScriptPlayerSetBaseConstructionEnabled(self, 
        readSide(0, ['side', 'playerName', 'player']),
        true,
      );
    case 'PLAYER_ENABLE_FACTORIES':
      return executeScriptPlayerSetObjectTemplateEnabled(self, 
        readSide(0, ['side', 'playerName', 'player']),
        readString(1, ['templateName', 'objectType', 'object', 'thingTemplate']),
        true,
      );
    case 'PLAYER_ENABLE_UNIT_CONSTRUCTION':
      return executeScriptPlayerSetUnitConstructionEnabled(self, 
        readSide(0, ['side', 'playerName', 'player']),
        true,
      );
    case 'CAMERA_MOVE_HOME':
      // Source parity: ScriptActions::doCameraMoveHome is an intentional no-op in C++.
      return true;
    case 'BUILD_TEAM':
      return executeScriptBuildTeam(self, 
        readString(0, ['teamName', 'team']),
      );
    case 'CREATE_REINFORCEMENT_TEAM':
      return executeScriptCreateReinforcementTeam(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['waypointName', 'waypoint']),
      );
    case 'CREATE_OBJECT':
      return executeScriptCreateObjectAtPosition(self, 
        readString(0, ['templateName', 'objectType', 'thingName', 'unitType']),
        readString(1, ['teamName', 'team']),
        readValue(2, ['position', 'coord3D', 'coord']),
        readNumber(3, ['angle', 'orientation', 'rotation']),
      );
    case 'CREATE_NAMED_ON_TEAM_AT_WAYPOINT':
      return executeScriptCreateUnitOnTeamAtWaypoint(self, 
        readString(0, ['objectName', 'entityName', 'name', 'unitName', 'named']),
        readString(1, ['templateName', 'objectType', 'thingName', 'unitType']),
        readString(2, ['teamName', 'team']),
        readString(3, ['waypointName', 'waypoint']),
      );
    case 'CREATE_UNNAMED_ON_TEAM_AT_WAYPOINT':
      return executeScriptCreateUnitOnTeamAtWaypoint(self, 
        '',
        readString(0, ['templateName', 'objectType', 'thingName', 'unitType']),
        readString(1, ['teamName', 'team']),
        readString(2, ['waypointName', 'waypoint']),
      );
    case 'UNIT_SPAWN_NAMED_LOCATION_ORIENTATION':
      return executeScriptCreateNamedObjectAtPosition(self, 
        readString(0, ['objectName', 'entityName', 'name', 'unitName', 'named']),
        readString(1, ['templateName', 'objectType', 'thingName', 'unitType']),
        readString(2, ['teamName', 'team']),
        readValue(3, ['position', 'coord3D', 'coord']),
        readNumber(4, ['angle', 'orientation', 'rotation']),
      );
    case 'NAMED_APPLY_ATTACK_PRIORITY_SET':
      return executeScriptNamedApplyAttackPrioritySet(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'unitName']),
        readString(1, ['attackPrioritySetName', 'attackPrioritySet', 'setName', 'set']),
      );
    case 'TEAM_APPLY_ATTACK_PRIORITY_SET':
      return executeScriptTeamApplyAttackPrioritySet(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['attackPrioritySetName', 'attackPrioritySet', 'setName', 'set']),
      );
    case 'SET_BASE_CONSTRUCTION_SPEED':
      return executeScriptSetBaseConstructionSpeed(self, 
        readSide(0, ['side', 'playerName', 'player']),
        readInteger(1, ['delayInSeconds', 'seconds', 'delay', 'value']),
      );
    case 'NAMED_SET_ATTITUDE':
      return executeScriptNamedSetAttitude(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'unitName']),
        readInteger(1, ['attitude', 'mood', 'value']),
      );
    case 'TEAM_SET_ATTITUDE':
      return executeScriptTeamSetAttitude(self, 
        readString(0, ['teamName', 'team']),
        readInteger(1, ['attitude', 'mood', 'value']),
      );
    case 'VICTORY':
      return setScriptLocalGameEndState(self, false, SCRIPT_ENDGAME_MESSAGE_DURATION_FRAMES);
    case 'QUICKVICTORY':
      return setScriptLocalGameEndState(self, false, SCRIPT_ENDGAME_QUICK_DURATION_FRAMES);
    case 'DEFEAT':
      return setScriptLocalGameEndState(self, true, SCRIPT_ENDGAME_MESSAGE_DURATION_FRAMES);
    case 'LOCALDEFEAT':
      return setScriptLocalDefeatState(self);
    case 'NAMED_DAMAGE':
      return executeScriptNamedDamage(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'unitName']),
        readInteger(1, ['damageAmount', 'damage', 'amount']),
      );
    case 'NAMED_DELETE':
      return executeScriptNamedDelete(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'unitName']),
      );
    case 'TEAM_DELETE':
      return executeScriptTeamDelete(self, 
        readString(0, ['teamName', 'team']),
        false,
      );
    case 'NAMED_KILL':
      return executeScriptNamedKill(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'unitName']),
      );
    case 'TEAM_KILL':
      return executeScriptTeamKill(self, 
        readString(0, ['teamName', 'team']),
      );
    case 'PLAYER_KILL':
      return executeScriptPlayerKill(self, 
        readSide(0, ['side', 'playerName', 'player']),
      );
    case 'TEAM_DELETE_LIVING':
      return executeScriptTeamDeleteLiving(self, 
        readString(0, ['teamName', 'team']),
      );
    case 'RESIZE_VIEW_GUARDBAND':
      return executeScriptResizeViewGuardband(self, 
        readNumber(0, ['guardbandX', 'x']),
        readNumber(1, ['guardbandY', 'y']),
      );
    case 'DELETE_ALL_UNMANNED':
      return executeScriptDeleteAllUnmanned(self);
    case 'CHOOSE_VICTIM_ALWAYS_USES_NORMAL':
      return executeScriptChooseVictimAlwaysUsesNormal(self, 
        readBoolean(0, ['enabled', 'value']),
      );
    case 'FREEZE_TIME':
      self.setScriptTimeFrozenByScript(true);
      return true;
    case 'UNFREEZE_TIME':
      self.setScriptTimeFrozenByScript(false);
      return true;
    case 'SHOW_WEATHER':
      self.setScriptWeatherVisible(readBoolean(0, ['showWeather', 'visible', 'enabled', 'value']));
      return true;
    case 'ENABLE_SCORING':
      self.setScriptScoringEnabled(true);
      return true;
    case 'DISABLE_SCORING':
      self.setScriptScoringEnabled(false);
      return true;
    case 'PLAY_SOUND_EFFECT':
      return self.requestScriptPlaySoundEffect(
        readString(0, ['soundEventName', 'soundName', 'audioName', 'sound']),
      );
    case 'PLAY_SOUND_EFFECT_AT':
      return self.requestScriptPlaySoundEffectAt(
        readString(0, ['soundEventName', 'soundName', 'audioName', 'sound']),
        readString(1, ['waypointName', 'waypoint']),
      );
    case 'SOUND_PLAY_NAMED':
      return self.requestScriptSoundPlayFromNamed(
        readString(0, ['soundEventName', 'soundName', 'audioName', 'sound']),
        readEntityId(1, ['entityId', 'unitId', 'named', 'unitName']),
      );
    case 'SPEECH_PLAY':
      return self.requestScriptSpeechPlay(
        readString(0, ['speechName', 'audioName', 'sound']),
        readBoolean(1, ['allowOverlap', 'overlap']),
      );
    case 'PLAYER_TRANSFER_OWNERSHIP_PLAYER':
      return executeScriptPlayerTransferOwnershipPlayer(self, 
        readString(0, ['sourceSide', 'sourcePlayer', 'fromPlayer']),
        readString(1, ['targetSide', 'targetPlayer', 'toPlayer']),
      );
    case 'NAMED_TRANSFER_OWNERSHIP_PLAYER':
      return executeScriptNamedTransferOwnershipPlayer(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'unitName']),
        readString(1, ['targetSide', 'targetPlayer', 'toPlayer']),
      );
    case 'MOVIE_PLAY_FULLSCREEN':
      return self.requestScriptMoviePlayback(
        readString(0, ['movieName', 'movie']),
        'FULLSCREEN',
      );
    case 'MOVIE_PLAY_RADAR':
      return self.requestScriptMoviePlayback(
        readString(0, ['movieName', 'movie']),
        'RADAR',
      );
    case 'DISPLAY_TEXT':
      return enqueueScriptDisplayText(self, 
        readString(0, ['displayText', 'text', 'message']),
      );
    case 'CAMEO_FLASH':
      return self.requestScriptCameoFlash(
        readString(0, ['commandButtonName', 'buttonName', 'button']),
        readInteger(1, ['timeInSeconds', 'seconds', 'duration']),
      );
    case 'NAMED_FLASH':
      return executeScriptNamedFlash(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readInteger(1, ['timeInSeconds', 'seconds', 'duration']),
      );
    case 'TEAM_FLASH':
      return executeScriptTeamFlash(self, 
        readString(0, ['teamName', 'team']),
        readInteger(1, ['timeInSeconds', 'seconds', 'duration']),
      );
    case 'SHOW_MILITARY_CAPTION':
      return enqueueScriptMilitaryCaption(self, 
        readString(0, ['captionText', 'briefing', 'text', 'message']),
        readNumber(1, ['duration', 'durationMs', 'milliseconds', 'time']),
      );
    case 'CAMERA_SET_AUDIBLE_DISTANCE':
      self.setScriptCameraAudibleDistance(
        readNumber(0, ['audibleDistance', 'distance', 'value']),
      );
      return true;
    case 'SET_STOPPING_DISTANCE':
      return executeScriptSetStoppingDistance(self, 
        readString(0, ['teamName', 'team']),
        readNumber(1, ['stoppingDistance', 'distance', 'value']),
      );
    case 'NAMED_SET_STOPPING_DISTANCE':
      return executeScriptNamedSetStoppingDistance(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'unitName']),
        readNumber(1, ['stoppingDistance', 'distance', 'value']),
      );
    case 'SET_FPS_LIMIT':
      self.setScriptFramesPerSecondLimit(
        readInteger(0, ['fpsLimit', 'framesPerSecondLimit', 'value']),
      );
      return true;
    case 'CAMERA_FADE_ADD':
      self.requestScriptCameraFade(
        'ADD',
        readNumber(0, ['minFade', 'minValue', 'min']),
        readNumber(1, ['maxFade', 'maxValue', 'max']),
        readInteger(2, ['increaseFrames', 'framesIncrease', 'increase']),
        readInteger(3, ['holdFrames', 'framesHold', 'hold']),
        readInteger(4, ['decreaseFrames', 'framesDecrease', 'decrease']),
      );
      return true;
    case 'CAMERA_FADE_SUBTRACT':
      self.requestScriptCameraFade(
        'SUBTRACT',
        readNumber(0, ['minFade', 'minValue', 'min']),
        readNumber(1, ['maxFade', 'maxValue', 'max']),
        readInteger(2, ['increaseFrames', 'framesIncrease', 'increase']),
        readInteger(3, ['holdFrames', 'framesHold', 'hold']),
        readInteger(4, ['decreaseFrames', 'framesDecrease', 'decrease']),
      );
      return true;
    case 'CAMERA_FADE_SATURATE':
      self.requestScriptCameraFade(
        'SATURATE',
        readNumber(0, ['minFade', 'minValue', 'min']),
        readNumber(1, ['maxFade', 'maxValue', 'max']),
        readInteger(2, ['increaseFrames', 'framesIncrease', 'increase']),
        readInteger(3, ['holdFrames', 'framesHold', 'hold']),
        readInteger(4, ['decreaseFrames', 'framesDecrease', 'decrease']),
      );
      return true;
    case 'CAMERA_FADE_MULTIPLY':
      self.requestScriptCameraFade(
        'MULTIPLY',
        readNumber(0, ['minFade', 'minValue', 'min']),
        readNumber(1, ['maxFade', 'maxValue', 'max']),
        readInteger(2, ['increaseFrames', 'framesIncrease', 'increase']),
        readInteger(3, ['holdFrames', 'framesHold', 'hold']),
        readInteger(4, ['decreaseFrames', 'framesDecrease', 'decrease']),
      );
      return true;
    case 'CAMERA_BW_MODE_BEGIN':
      self.requestScriptCameraBlackWhiteMode(
        true,
        readInteger(0, ['frames', 'fadeFrames', 'value']),
      );
      return true;
    case 'CAMERA_BW_MODE_END':
      self.requestScriptCameraBlackWhiteMode(
        false,
        readInteger(0, ['frames', 'fadeFrames', 'value']),
      );
      return true;
    case 'DRAW_SKYBOX_BEGIN':
      self.setScriptSkyboxEnabled(true);
      return true;
    case 'DRAW_SKYBOX_END':
      self.setScriptSkyboxEnabled(false);
      return true;
    case 'SET_ATTACK_PRIORITY_THING':
      return executeScriptSetAttackPriorityThing(self, 
        readString(0, ['attackPrioritySetName', 'attackPrioritySet', 'setName', 'set']),
        readString(1, ['templateName', 'objectType', 'object', 'thingTemplate']),
        readInteger(2, ['priority', 'value']),
      );
    case 'SET_ATTACK_PRIORITY_KIND_OF':
      return executeScriptSetAttackPriorityKindOf(self, 
        readString(0, ['attackPrioritySetName', 'attackPrioritySet', 'setName', 'set']),
        readInteger(1, ['kindOfBit', 'kindOf', 'kind', 'kindOfIndex']),
        readInteger(2, ['priority', 'value']),
      );
    case 'SET_DEFAULT_ATTACK_PRIORITY':
      return executeScriptSetDefaultAttackPriority(self, 
        readString(0, ['attackPrioritySetName', 'attackPrioritySet', 'setName', 'set']),
        readInteger(1, ['defaultPriority', 'priority', 'value']),
      );
    case 'CAMERA_ENABLE_SLAVE_MODE':
      return self.setScriptCameraSlaveMode(
        readString(0, ['thingTemplateName', 'templateName', 'objectType']),
        readString(1, ['boneName', 'bone']),
      );
    case 'CAMERA_DISABLE_SLAVE_MODE':
      self.clearScriptCameraSlaveMode();
      return true;
    case 'CAMERA_ADD_SHAKER_AT':
      return self.requestScriptCameraAddShaker(
        readString(0, ['waypointName', 'waypoint']),
        readNumber(1, ['amplitude', 'intensity']),
        readNumber(2, ['seconds', 'durationSeconds', 'duration']),
        readNumber(3, ['radius']),
      );
    case 'SET_TRAIN_HELD':
      return executeScriptSetTrainHeld(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readBoolean(1, ['held', 'enabled', 'value']),
      );
    case 'CAMERA_MOTION_BLUR':
      self.requestScriptCameraMotionBlur(
        readBoolean(0, ['zoomIn', 'zoom', 'value']),
        readBoolean(1, ['saturate', 'value']),
      );
      return true;
    case 'CAMERA_MOTION_BLUR_JUMP':
      return self.requestScriptCameraMotionBlurJump(
        readString(0, ['waypointName', 'waypoint']),
        readBoolean(1, ['saturate', 'value']),
      );
    case 'CAMERA_MOTION_BLUR_FOLLOW':
      self.requestScriptCameraMotionBlurFollow(
        readInteger(0, ['mode', 'filterMode', 'value']),
      );
      return true;
    case 'CAMERA_MOTION_BLUR_END_FOLLOW':
      self.requestScriptCameraMotionBlurEndFollow();
      return true;
    case 'CAMERA_LETTERBOX_BEGIN':
      self.setScriptLetterboxEnabled(true);
      return true;
    case 'CAMERA_LETTERBOX_END':
      self.setScriptLetterboxEnabled(false);
      return true;
    case 'CAMERA_FOLLOW_NAMED':
      return self.setScriptCameraFollowNamed(
        readEntityId(0, ['entityId', 'unitId', 'named', 'unitName']),
        readBoolean(1, ['snapToUnit', 'snap']),
      );
    case 'OVERSIZE_TERRAIN':
      return executeScriptOversizeTerrain(self, 
        readInteger(0, ['amount', 'oversizeAmount', 'value']),
      );
    case 'CAMERA_STOP_FOLLOW':
      self.clearScriptCameraFollowNamed();
      return true;
    case 'MOVE_CAMERA_TO_SELECTION':
      return self.requestScriptCameraModMoveToSelection();
    case 'CAMERA_MOD_FREEZE_TIME':
      self.requestScriptCameraModFreezeTime();
      return true;
    case 'CAMERA_MOD_FREEZE_ANGLE':
      self.requestScriptCameraModFreezeAngle();
      return true;
    case 'CAMERA_MOD_SET_FINAL_ZOOM':
      return self.requestScriptCameraModFinalZoom(
        readNumber(0, ['zoom', 'finalZoom']),
        readNumber(1, ['easeIn', 'easeInPercent']),
        readNumber(2, ['easeOut', 'easeOutPercent']),
      );
    case 'CAMERA_MOD_SET_FINAL_PITCH':
      return self.requestScriptCameraModFinalPitch(
        readNumber(0, ['pitch', 'finalPitch']),
        readNumber(1, ['easeIn', 'easeInPercent']),
        readNumber(2, ['easeOut', 'easeOutPercent']),
      );
    case 'CAMERA_MOD_SET_FINAL_SPEED_MULTIPLIER':
      self.requestScriptCameraModFinalSpeedMultiplier(
        readInteger(0, ['multiplier', 'timeMultiplier', 'value']),
      );
      return true;
    case 'CAMERA_MOD_SET_ROLLING_AVERAGE':
      self.requestScriptCameraModRollingAverage(
        readInteger(0, ['framesToAverage', 'rollingAverageFrames', 'frames']),
      );
      return true;
    case 'CAMERA_MOD_FINAL_LOOK_TOWARD':
      return self.requestScriptCameraModFinalLookToward(
        readString(0, ['waypointName', 'waypoint']),
      );
    case 'CAMERA_MOD_LOOK_TOWARD':
      return self.requestScriptCameraModLookToward(
        readString(0, ['waypointName', 'waypoint']),
      );
    case 'SUSPEND_BACKGROUND_SOUNDS':
      self.setScriptBackgroundSoundsPaused(true);
      return true;
    case 'RESUME_BACKGROUND_SOUNDS':
      self.setScriptBackgroundSoundsPaused(false);
      return true;
    case 'SOUND_AMBIENT_PAUSE':
      self.setScriptAmbientSoundsPaused(true);
      return true;
    case 'SOUND_AMBIENT_RESUME':
      self.setScriptAmbientSoundsPaused(false);
      return true;
    case 'ENABLE_OBJECT_SOUND':
      return executeScriptSetObjectAmbientSound(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        true,
      );
    case 'DISABLE_OBJECT_SOUND':
      return executeScriptSetObjectAmbientSound(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        false,
      );
    case 'MUSIC_SET_TRACK':
      return setScriptMusicTrack(self, 
        readString(0, ['musicName', 'trackName', 'track']),
        readBoolean(1, ['fadeOut', 'fadeout']),
        readBoolean(2, ['fadeIn', 'fadein']),
      );
    case 'SET_VISUAL_SPEED_MULTIPLIER':
      return setScriptVisualSpeedMultiplier(self, 
        readInteger(0, ['multiplier', 'timeMultiplier', 'value']),
      );
    case 'SET_INFANTRY_LIGHTING_OVERRIDE':
      return setScriptInfantryLightingOverride(self, 
        readNumber(0, ['setting', 'scale', 'value']),
      );
    case 'RESET_INFANTRY_LIGHTING_OVERRIDE':
      return setScriptInfantryLightingOverride(self, -1);
    case 'SET_TREE_SWAY':
      return executeScriptSetTreeSway(self, 
        readNumber(0, ['direction', 'windDirection', 'angle']),
        readNumber(1, ['intensity', 'sway', 'swayAmount']),
        readNumber(2, ['lean', 'leanAmount']),
        readInteger(3, ['breezePeriodFrames', 'periodFrames', 'frames']),
        readNumber(4, ['randomness', 'variation']),
      );
    case 'DEBUG_STRING':
      return executeScriptDebugMessage(self, 
        readString(0, ['debugString', 'text', 'message']),
        false,
        false,
      );
    case 'DEBUG_CRASH_BOX':
      return executeScriptDebugMessage(self, 
        readString(0, ['debugString', 'text', 'message']),
        true,
        false,
      );
    case 'DEBUG_MESSAGE_BOX':
      return executeScriptDebugMessage(self, 
        readString(0, ['debugString', 'text', 'message']),
        false,
        true,
      );
    case 'TEAM_GARRISON_SPECIFIC_BUILDING':
      return executeScriptTeamGarrisonSpecificBuilding(self, 
        readString(0, ['teamName', 'team']),
        readEntityId(1, ['buildingEntityId', 'entityId', 'buildingId', 'unitId', 'named']),
      );
    case 'EXIT_SPECIFIC_BUILDING':
      return executeScriptExitSpecificBuilding(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'buildingId']),
      );
    case 'TEAM_GARRISON_NEAREST_BUILDING':
      return executeScriptTeamGarrisonNearestBuilding(self, 
        readString(0, ['teamName', 'team']),
      );
    case 'TEAM_EXIT_ALL_BUILDINGS':
      return executeScriptTeamExitAllBuildings(self, 
        readString(0, ['teamName', 'team']),
      );
    case 'NAMED_GARRISON_SPECIFIC_BUILDING':
      return executeScriptNamedGarrisonSpecificBuilding(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readEntityId(1, ['buildingEntityId', 'entityId', 'buildingId', 'targetEntityId']),
      );
    case 'NAMED_GARRISON_NEAREST_BUILDING':
      return executeScriptNamedGarrisonNearestBuilding(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
      );
    case 'NAMED_EXIT_BUILDING':
      return executeScriptNamedExitBuilding(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
      );
    case 'PLAYER_GARRISON_ALL_BUILDINGS':
      return executeScriptPlayerGarrisonAllBuildings(self, 
        readSide(0, ['side', 'playerName', 'player']),
      );
    case 'PLAYER_EXIT_ALL_BUILDINGS':
      return executeScriptPlayerExitAllBuildings(self, 
        readSide(0, ['side', 'playerName', 'player']),
      );
    case 'TEAM_WANDER':
      return executeScriptTeamWander(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['waypointPathName', 'waypointPathLabel', 'pathLabel', 'waypointPath']),
      );
    case 'TEAM_PANIC':
      return executeScriptTeamPanic(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['waypointPathName', 'waypointPathLabel', 'pathLabel', 'waypointPath']),
      );
    case 'MOVE_CAMERA_TO':
      return self.requestScriptMoveCameraTo(
        readString(0, ['waypointName', 'waypoint']),
        readNumber(1, ['seconds', 'durationSeconds', 'duration']),
        readNumber(2, ['cameraStutterSeconds', 'cameraStutter', 'stutter']),
        readNumber(3, ['easeInSeconds', 'easeIn']),
        readNumber(4, ['easeOutSeconds', 'easeOut']),
      );
    case 'MOVE_CAMERA_ALONG_WAYPOINT_PATH':
      return self.requestScriptMoveCameraAlongWaypointPath(
        readString(0, ['waypointName', 'waypoint', 'waypointPathName', 'waypointPath']),
        readNumber(1, ['seconds', 'durationSeconds', 'duration']),
        readNumber(2, ['cameraStutterSeconds', 'cameraStutter', 'stutter']),
        readNumber(3, ['easeInSeconds', 'easeIn']),
        readNumber(4, ['easeOutSeconds', 'easeOut']),
      );
    case 'RESET_CAMERA':
      return self.requestScriptResetCamera(
        readString(0, ['waypointName', 'waypoint']),
        readNumber(1, ['seconds', 'durationSeconds', 'duration']),
        readNumber(2, ['easeInSeconds', 'easeIn']),
        readNumber(3, ['easeOutSeconds', 'easeOut']),
      );
    case 'ROTATE_CAMERA':
      return self.requestScriptRotateCamera(
        readNumber(0, ['rotations']),
        readNumber(1, ['seconds', 'durationSeconds', 'duration']),
        readNumber(2, ['easeInSeconds', 'easeIn']),
        readNumber(3, ['easeOutSeconds', 'easeOut']),
      );
    case 'SETUP_CAMERA':
      return self.requestScriptSetupCamera(
        readString(0, ['waypointName', 'waypoint']),
        readNumber(1, ['zoom']),
        readNumber(2, ['pitch']),
        readString(3, ['lookAtWaypointName', 'lookAtWaypoint', 'lookWaypointName', 'lookWaypoint']),
      );
    case 'ZOOM_CAMERA':
      return self.requestScriptZoomCamera(
        readNumber(0, ['zoom']),
        readNumber(1, ['seconds', 'durationSeconds', 'duration']),
        readNumber(2, ['easeInSeconds', 'easeIn']),
        readNumber(3, ['easeOutSeconds', 'easeOut']),
      );
    case 'PITCH_CAMERA':
      return self.requestScriptPitchCamera(
        readNumber(0, ['pitch']),
        readNumber(1, ['seconds', 'durationSeconds', 'duration']),
        readNumber(2, ['easeInSeconds', 'easeIn']),
        readNumber(3, ['easeOutSeconds', 'easeOut']),
      );
    case 'SOUND_SET_VOLUME':
      self.setScriptSoundVolumeScale(readNumber(0, ['newVolume', 'volume', 'volumePercent', 'value']));
      return true;
    case 'SPEECH_SET_VOLUME':
      self.setScriptSpeechVolumeScale(readNumber(0, ['newVolume', 'volume', 'volumePercent', 'value']));
      return true;
    case 'MUSIC_SET_VOLUME':
      self.setScriptMusicVolumeScale(readNumber(0, ['newVolume', 'volume', 'volumePercent', 'value']));
      return true;
    case 'DISABLE_BORDER_SHROUD':
      self.setScriptBorderShroudEnabled(false);
      return true;
    case 'ENABLE_BORDER_SHROUD':
      self.setScriptBorderShroudEnabled(true);
      return true;
    case 'OBJECT_ALLOW_BONUSES':
      self.setScriptObjectsReceiveDifficultyBonus(readBoolean(0, ['enabled', 'value', 'allowBonuses']));
      return true;
    case 'PLAYER_EXCLUDE_FROM_SCORE_SCREEN':
      return self.setSideExcludedFromScoreScreen(
        readSide(0, ['side', 'playerName', 'player']),
        true,
      );
    case 'TEAM_AVAILABLE_FOR_RECRUITMENT':
      return executeScriptTeamAvailableForRecruitment(self, 
        readString(0, ['teamName', 'team']),
        readBoolean(1, ['availability', 'recruitable', 'enabled', 'value']),
      );
    case 'TEAM_COLLECT_NEARBY_FOR_TEAM':
      return executeScriptTeamCollectNearbyForTeam(self, 
        readString(0, ['teamName', 'team']),
      );
    case 'TEAM_MERGE_INTO_TEAM':
      return executeScriptTeamMergeIntoTeam(self, 
        readString(0, ['sourceTeamName', 'sourceTeam', 'teamName', 'team']),
        readString(1, ['targetTeamName', 'targetTeam', 'otherTeam']),
      );
    case 'TEAM_GUARD_SUPPLY_CENTER':
      return executeScriptTeamGuardSupplyCenter(self, 
        readString(0, ['teamName', 'team']),
        readInteger(1, ['supplies', 'minimumCash', 'value']),
      );
    case 'TEAM_GUARD_IN_TUNNEL_NETWORK':
      return executeScriptTeamGuardInTunnelNetwork(self, 
        readString(0, ['teamName', 'team']),
      );
    case 'DISABLE_INPUT':
      self.setScriptInputDisabled(true);
      return true;
    case 'ENABLE_INPUT':
      self.setScriptInputDisabled(false);
      return true;
    case 'RADAR_DISABLE':
      self.setScriptRadarHidden(true);
      return true;
    case 'RADAR_ENABLE':
      self.setScriptRadarHidden(false);
      return true;
    case 'RADAR_FORCE_ENABLE':
      self.setScriptRadarForced(true);
      return true;
    case 'RADAR_REVERT_TO_NORMAL':
      self.setScriptRadarForced(false);
      return true;
    case 'REFRESH_RADAR':
      self.requestScriptRadarRefresh();
      return true;
    case 'SCREEN_SHAKE':
      return self.setScriptScreenShake(readInteger(0, ['intensity', 'shakeType', 'cameraShakeType']));
    case 'TECHTREE_MODIFY_BUILDABILITY_OBJECT':
      return executeScriptModifyBuildableStatus(self, 
        readString(0, ['templateName', 'objectType', 'object', 'thingTemplate']),
        coerceScriptBuildableStatus(self, readValue(1, ['buildableStatus', 'status', 'buildable'])),
      );
    case 'WAREHOUSE_SET_VALUE':
      return executeScriptWarehouseSetValue(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readInteger(1, ['cashValue', 'value', 'amount']),
      );
    case 'RADAR_CREATE_EVENT':
      return executeScriptRadarCreateEvent(self, 
        readValue(0, ['position', 'coord3D', 'coord', 'location', 'waypoint']),
        readInteger(1, ['eventType', 'type']),
      );
    case 'OBJECT_CREATE_RADAR_EVENT':
      return executeScriptObjectCreateRadarEvent(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readInteger(1, ['eventType', 'type']),
      );
    case 'TEAM_CREATE_RADAR_EVENT':
      return executeScriptTeamCreateRadarEvent(self, 
        readString(0, ['teamName', 'team']),
        readInteger(1, ['eventType', 'type']),
      );
    case 'DISPLAY_CINEMATIC_TEXT':
      return self.setScriptCinematicText(
        readString(0, ['displayText', 'text', 'message']),
        readString(1, ['fontType', 'font']),
        readInteger(2, ['timeInSeconds', 'seconds', 'time']),
      );
    case 'SOUND_DISABLE_TYPE':
      return self.setScriptAudioEventEnabled(
        readString(0, ['soundEventName', 'eventName', 'soundType', 'sound']),
        false,
      );
    case 'SOUND_ENABLE_TYPE':
      return self.setScriptAudioEventEnabled(
        readString(0, ['soundEventName', 'eventName', 'soundType', 'sound']),
        true,
      );
    case 'SOUND_ENABLE_ALL':
      return self.setScriptAudioEventEnabled('', true);
    case 'SOUND_REMOVE_ALL_DISABLED':
      self.requestScriptAudioRemoveAllDisabled();
      return true;
    case 'SOUND_REMOVE_TYPE':
      return self.requestScriptAudioRemoveType(
        readString(0, ['soundEventName', 'eventName', 'soundType', 'sound']),
      );
    case 'AUDIO_OVERRIDE_VOLUME_TYPE':
      return self.setScriptAudioEventVolumeOverride(
        readString(0, ['soundEventName', 'eventName', 'soundType', 'sound']),
        readNumber(1, ['newVolume', 'volume', 'volumePercent', 'value']),
      );
    case 'AUDIO_RESTORE_VOLUME_TYPE':
      return self.setScriptAudioEventVolumeOverride(
        readString(0, ['soundEventName', 'eventName', 'soundType', 'sound']),
        -100,
      );
    case 'AUDIO_RESTORE_VOLUME_ALL_TYPE':
      return self.setScriptAudioEventVolumeOverride('', -100);
    case 'INGAME_POPUP_MESSAGE':
      return enqueueScriptPopupMessage(self, 
        readString(0, ['message', 'text']),
        readInteger(1, ['x']),
        readInteger(2, ['y']),
        readInteger(3, ['width']),
        readBoolean(4, ['pause']),
      );
    case 'DISPLAY_COUNTER':
      return setScriptDisplayedCounter(self, 
        readString(0, ['counterName', 'counter']),
        readString(1, ['counterText', 'text', 'displayText']),
        false,
      );
    case 'HIDE_COUNTER':
      return hideScriptDisplayedCounter(self, readString(0, ['counterName', 'counter']));
    case 'DISPLAY_COUNTDOWN_TIMER':
      return setScriptDisplayedCounter(self, 
        readString(0, ['timerName', 'counterName', 'counter']),
        readString(1, ['timerText', 'counterText', 'text', 'displayText']),
        true,
      );
    case 'HIDE_COUNTDOWN_TIMER':
      return hideScriptDisplayedCounter(self, readString(0, ['timerName', 'counterName', 'counter']));
    case 'DISABLE_SPECIAL_POWER_DISPLAY':
      setScriptSpecialPowerDisplayEnabled(self, false);
      return true;
    case 'ENABLE_SPECIAL_POWER_DISPLAY':
      setScriptSpecialPowerDisplayEnabled(self, true);
      return true;
    case 'NAMED_HIDE_SPECIAL_POWER_DISPLAY':
      return setScriptNamedSpecialPowerDisplayHidden(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        true,
      );
    case 'NAMED_SHOW_SPECIAL_POWER_DISPLAY':
      return setScriptNamedSpecialPowerDisplayHidden(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        false,
      );
    case 'ENABLE_COUNTDOWN_TIMER_DISPLAY':
      setScriptNamedTimerDisplayEnabled(self, true);
      return true;
    case 'DISABLE_COUNTDOWN_TIMER_DISPLAY':
      setScriptNamedTimerDisplayEnabled(self, false);
      return true;
    case 'NAMED_USE_COMMANDBUTTON_ABILITY_ON_NAMED':
      return executeScriptNamedUseCommandButtonAbilityOnNamed(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
        readEntityId(2, ['targetEntityId', 'entityId', 'targetObjectId', 'unitId', 'named']),
      );
    case 'NAMED_USE_COMMANDBUTTON_ABILITY_AT_WAYPOINT':
      return executeScriptNamedUseCommandButtonAbilityAtWaypoint(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
        readString(2, ['waypointName', 'waypoint']),
      );
    case 'NAMED_USE_COMMANDBUTTON_ABILITY_USING_WAYPOINT_PATH':
      return executeScriptNamedUseCommandButtonAbilityUsingWaypointPath(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
        readString(2, ['waypointPathName', 'waypointPathLabel', 'pathLabel', 'waypointPath']),
      );
    case 'TEAM_USE_COMMANDBUTTON_ABILITY_ON_NAMED':
      return executeScriptTeamUseCommandButtonAbilityOnNamed(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
        readEntityId(2, ['targetEntityId', 'entityId', 'targetObjectId', 'unitId', 'named']),
      );
    case 'TEAM_USE_COMMANDBUTTON_ABILITY_AT_WAYPOINT':
      return executeScriptTeamUseCommandButtonAbilityAtWaypoint(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
        readString(2, ['waypointName', 'waypoint']),
      );
    case 'NAMED_USE_COMMANDBUTTON_ABILITY':
      return executeScriptNamedUseCommandButtonAbility(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
      );
    case 'TEAM_USE_COMMANDBUTTON_ABILITY':
      return executeScriptTeamUseCommandButtonAbility(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
      );
    case 'NAMED_ENTER_NAMED':
      return executeScriptNamedEnterNamed(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'sourceEntityId']),
        readEntityId(1, ['targetEntityId', 'entityId', 'unitId', 'named', 'transportId']),
      );
    case 'TEAM_ENTER_NAMED':
      return executeScriptTeamEnterNamed(self, 
        readString(0, ['teamName', 'team']),
        readEntityId(1, ['targetEntityId', 'entityId', 'unitId', 'named', 'transportId']),
      );
    case 'NAMED_EXIT_ALL':
      return executeScriptNamedExitAll(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'transportId']),
      );
    case 'TEAM_EXIT_ALL':
      return executeScriptTeamExitAll(self, 
        readString(0, ['teamName', 'team']),
      );
    case 'NAMED_GUARD':
      return executeScriptNamedGuard(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
      );
    case 'TEAM_GUARD':
      return executeScriptTeamGuard(self, 
        readString(0, ['teamName', 'team']),
      );
    case 'NAMED_FOLLOW_WAYPOINTS':
      return executeScriptNamedFollowWaypoints(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['waypointPathName', 'waypointPathLabel', 'pathLabel', 'waypointPath']),
        false,
      );
    case 'TEAM_FOLLOW_WAYPOINTS':
      return executeScriptTeamFollowWaypoints(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['waypointPathName', 'waypointPathLabel', 'pathLabel', 'waypointPath']),
        readBoolean(2, ['asTeam', 'asGroup']),
        false,
      );
    case 'NAMED_FOLLOW_WAYPOINTS_EXACT':
      return executeScriptNamedFollowWaypoints(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['waypointPathName', 'waypointPathLabel', 'pathLabel', 'waypointPath']),
        true,
      );
    case 'TEAM_FOLLOW_WAYPOINTS_EXACT':
      return executeScriptTeamFollowWaypoints(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['waypointPathName', 'waypointPathLabel', 'pathLabel', 'waypointPath']),
        readBoolean(2, ['asTeam', 'asGroup']),
        true,
      );
    case 'NAMED_FLASH_WHITE':
      return executeScriptNamedFlashWhite(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readInteger(1, ['timeInSeconds', 'seconds', 'duration']),
      );
    case 'TEAM_FLASH_WHITE':
      return executeScriptTeamFlashWhite(self, 
        readString(0, ['teamName', 'team']),
        readInteger(1, ['timeInSeconds', 'seconds', 'duration']),
      );
    case 'SKIRMISH_BUILD_BUILDING':
      return executeScriptSkirmishBuildBuilding(self, 
        readString(0, ['templateName', 'objectType', 'object', 'thingTemplate']),
        readSide(1, ['side', 'playerName', 'player', 'currentPlayerSide']),
      );
    case 'AI_PLAYER_BUILD_SUPPLY_CENTER':
      return executeScriptAIPlayerBuildSupplyCenter(self, 
        readSide(0, ['side', 'playerName', 'player', 'currentPlayerSide']),
        readString(1, ['templateName', 'objectType', 'object', 'thingTemplate']),
        readInteger(2, ['minimumCash', 'cash', 'value']),
      );
    case 'AI_PLAYER_BUILD_UPGRADE':
      return executeScriptAIPlayerBuildUpgrade(self, 
        readSide(0, ['side', 'playerName', 'player', 'currentPlayerSide']),
        readString(1, ['upgradeName', 'upgrade']),
      );
    case 'AI_PLAYER_BUILD_TYPE_NEAREST_TEAM':
      return executeScriptAIPlayerBuildTypeNearestTeam(self, 
        readSide(0, ['side', 'playerName', 'player', 'currentPlayerSide']),
        readString(1, ['templateName', 'objectType', 'object', 'thingTemplate']),
        readString(2, ['teamName', 'team']),
      );
    case 'SKIRMISH_FOLLOW_APPROACH_PATH':
      return executeScriptTeamFollowSkirmishApproachPath(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['waypointPathLabel', 'pathLabel', 'waypointPath']),
        readBoolean(2, ['asTeam', 'asGroup']),
        readSide(3, ['side', 'playerName', 'player', 'currentPlayerSide']),
      );
    case 'SKIRMISH_MOVE_TO_APPROACH_PATH':
      return executeScriptTeamMoveToSkirmishApproachPath(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['waypointPathLabel', 'pathLabel', 'waypointPath']),
        readSide(2, ['side', 'playerName', 'player', 'currentPlayerSide']),
      );
    case 'SKIRMISH_BUILD_BASE_DEFENSE_FRONT':
      return executeScriptSkirmishBuildBaseDefenseFront(self, 
        readSide(0, ['side', 'playerName', 'player', 'currentPlayerSide']),
      );
    case 'SKIRMISH_FIRE_SPECIAL_POWER_AT_MOST_COST':
      return executeScriptSkirmishFireSpecialPowerAtMostCost(self, 
        readSide(0, ['side', 'playerName', 'player', 'currentPlayerSide']),
        readString(1, ['specialPowerName', 'specialPower']),
      );
    case 'NAMED_STOP_SPECIAL_POWER_COUNTDOWN':
      return executeScriptNamedStopSpecialPowerCountdown(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['specialPowerName', 'specialPower']),
        true,
      );
    case 'NAMED_START_SPECIAL_POWER_COUNTDOWN':
      return executeScriptNamedStopSpecialPowerCountdown(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['specialPowerName', 'specialPower']),
        false,
      );
    case 'NAMED_SET_SPECIAL_POWER_COUNTDOWN':
      return executeScriptNamedSetSpecialPowerCountdown(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['specialPowerName', 'specialPower']),
        readInteger(2, ['timeInSeconds', 'seconds', 'duration']),
      );
    case 'NAMED_ADD_SPECIAL_POWER_COUNTDOWN':
      return executeScriptNamedAddSpecialPowerCountdown(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['specialPowerName', 'specialPower']),
        readInteger(2, ['timeInSeconds', 'seconds', 'duration']),
      );
    case 'NAMED_FIRE_SPECIAL_POWER_AT_WAYPOINT':
      return executeScriptNamedFireSpecialPowerAtWaypoint(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['specialPowerName', 'specialPower']),
        readString(2, ['waypointName', 'waypoint']),
      );
    case 'NAMED_FIRE_SPECIAL_POWER_AT_NAMED':
      return executeScriptNamedFireSpecialPowerAtNamed(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['specialPowerName', 'specialPower']),
        readEntityId(2, ['targetEntityId', 'entityId', 'targetObjectId', 'unitId', 'named']),
      );
    case 'IDLE_ALL_UNITS':
      return executeScriptIdleAllUnits(self);
    case 'RESUME_SUPPLY_TRUCKING':
      return executeScriptResumeSupplyTrucking(self);
    case 'NAMED_CUSTOM_COLOR':
      return executeScriptNamedCustomColor(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'namedUnit']),
        readInteger(1, ['color', 'customColor']),
      );
    case 'NAMED_RECEIVE_UPGRADE':
      return executeScriptNamedReceiveUpgrade(self, 
        readEntityId(0, ['entityId', 'unitId', 'named', 'namedUnit']),
        readString(1, ['upgradeName', 'upgrade']),
      );
    case 'PLAYER_REPAIR_NAMED_STRUCTURE':
      return executeScriptPlayerRepairNamedStructure(self, 
        readSide(0, ['side', 'playerName', 'player']),
        readEntityId(1, ['targetEntityId', 'entityId', 'targetBuildingId', 'unitId', 'named']),
      );
    case 'SKIRMISH_BUILD_BASE_DEFENSE_FLANK':
      return executeScriptSkirmishBuildBaseDefenseFlank(self, 
        readSide(0, ['side', 'playerName', 'player', 'currentPlayerSide']),
      );
    case 'SKIRMISH_BUILD_STRUCTURE_FRONT':
      return executeScriptSkirmishBuildStructureFront(self, 
        readString(0, ['templateName', 'objectType', 'object', 'thingTemplate']),
        readSide(1, ['side', 'playerName', 'player', 'currentPlayerSide']),
      );
    case 'SKIRMISH_BUILD_STRUCTURE_FLANK':
      return executeScriptSkirmishBuildStructureFlank(self, 
        readString(0, ['templateName', 'objectType', 'object', 'thingTemplate']),
        readSide(1, ['side', 'playerName', 'player', 'currentPlayerSide']),
      );
    case 'SKIRMISH_ATTACK_NEAREST_GROUP_WITH_VALUE':
      return executeScriptSkirmishAttackNearestGroupWithValue(self, 
        readString(0, ['teamName', 'team']),
        readInteger(1, ['comparison']),
        readInteger(2, ['value']),
      );
    case 'SKIRMISH_PERFORM_COMMANDBUTTON_ON_MOST_VALUABLE_OBJECT':
      return executeScriptSkirmishCommandButtonOnMostValuableObject(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
        readNumber(2, ['range']),
        readBoolean(3, ['allTeamMembers', 'allMembers', 'all']),
      );
    case 'SKIRMISH_WAIT_FOR_COMMANDBUTTON_AVAILABLE_ALL':
      return executeScriptSkirmishWaitForCommandButtonAvailability(self, 
        readString(1, ['teamName', 'team']),
        readString(2, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
        true,
      );
    case 'SKIRMISH_WAIT_FOR_COMMANDBUTTON_AVAILABLE_PARTIAL':
      return executeScriptSkirmishWaitForCommandButtonAvailability(self, 
        readString(1, ['teamName', 'team']),
        readString(2, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
        false,
      );
    case 'TEAM_WAIT_FOR_NOT_CONTAINED_ALL':
      return executeScriptTeamWaitForNotContained(self, 
        readString(0, ['teamName', 'team']),
        true,
      );
    case 'TEAM_WAIT_FOR_NOT_CONTAINED_PARTIAL':
      return executeScriptTeamWaitForNotContained(self, 
        readString(0, ['teamName', 'team']),
        false,
      );
    case 'TEAM_SPIN_FOR_FRAMECOUNT':
      return executeScriptTeamSpinForFramecount(self, 
        readString(0, ['teamName', 'team']),
        readInteger(1, ['frameCount', 'frames', 'waitFrames']),
      );
    case 'TEAM_ALL_USE_COMMANDBUTTON_ON_NAMED':
      return executeScriptTeamAllUseCommandButtonOnNamed(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
        readEntityId(2, ['targetEntityId', 'entityId', 'targetObjectId', 'unitId', 'named']),
      );
    case 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_ENEMY_UNIT':
      return executeScriptTeamAllUseCommandButtonOnNearestEnemyUnit(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
      );
    case 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_GARRISONED_BUILDING':
      return executeScriptTeamAllUseCommandButtonOnNearestGarrisonedBuilding(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
      );
    case 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_KINDOF':
      return executeScriptTeamAllUseCommandButtonOnNearestKindOf(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
        readValue(2, ['kindOf', 'kindOfBit', 'kindOfType']),
      );
    case 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_ENEMY_BUILDING':
      return executeScriptTeamAllUseCommandButtonOnNearestEnemyBuilding(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
      );
    case 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_ENEMY_BUILDING_CLASS':
      return executeScriptTeamAllUseCommandButtonOnNearestEnemyBuildingClass(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
        readValue(2, ['kindOf', 'kindOfBit', 'kindOfType']),
      );
    case 'TEAM_ALL_USE_COMMANDBUTTON_ON_NEAREST_OBJECTTYPE':
      return executeScriptTeamAllUseCommandButtonOnNearestObjectType(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
        readString(2, ['templateName', 'objectType', 'object', 'thingTemplate']),
      );
    case 'TEAM_PARTIAL_USE_COMMANDBUTTON':
      return executeScriptTeamPartialUseCommandButton(self, 
        readNumber(0, ['percentage', 'percent']),
        readString(1, ['teamName', 'team']),
        readString(2, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
      );
    case 'TEAM_CAPTURE_NEAREST_UNOWNED_FACTION_UNIT':
      return executeScriptTeamCaptureNearestUnownedFactionUnit(self, 
        readString(0, ['teamName', 'team']),
      );
    case 'PLAYER_CREATE_TEAM_FROM_CAPTURED_UNITS':
      return executeScriptPlayerCreateTeamFromCapturedUnits(self, 
        readSide(0, ['side', 'playerName', 'player']),
        readString(1, ['teamName', 'team']),
      );
    case 'ENABLE_SCRIPT':
      return self.setScriptActive(readString(0, ['scriptName', 'script']), true);
    case 'DISABLE_SCRIPT':
      return self.setScriptActive(readString(0, ['scriptName', 'script']), false);
    case 'CALL_SUBROUTINE':
      return self.notifyScriptSubroutineCall(readString(0, ['scriptName', 'script']));
    case 'SET_FLAG':
      return self.setScriptFlag(
        readString(0, ['flagName', 'flag']),
        readBoolean(1, ['value', 'enabled']),
      );
    case 'SET_COUNTER':
      return self.setScriptCounter(
        readString(0, ['counterName', 'counter']),
        readInteger(1, ['value']),
      );
    case 'TEAM_SET_STATE':
      return self.setScriptTeamState(
        readString(0, ['teamName', 'team']),
        readString(1, ['stateName', 'state']),
      );
    case 'INCREMENT_COUNTER':
      return self.addScriptCounter(
        readString(1, ['counterName', 'counter']),
        readInteger(0, ['value']),
      );
    case 'DECREMENT_COUNTER':
      return self.addScriptCounter(
        readString(1, ['counterName', 'counter']),
        -readInteger(0, ['value']),
      );
    case 'SET_TIMER':
      return self.startScriptTimer(
        readString(0, ['counterName', 'counter']),
        readInteger(1, ['value', 'frames']),
      );
    case 'SET_RANDOM_TIMER': {
      const minFrames = readInteger(1, ['value', 'minFrames']);
      const maxFrames = readInteger(2, ['randomValue', 'maxFrames']);
      return self.startScriptTimer(
        readString(0, ['counterName', 'counter']),
        resolveScriptRandomInt(self, minFrames, maxFrames),
      );
    }
    case 'STOP_TIMER':
      return self.pauseScriptTimer(readString(0, ['counterName', 'counter']));
    case 'RESTART_TIMER':
      return self.resumeScriptTimer(readString(0, ['counterName', 'counter']));
    case 'SET_MILLISECOND_TIMER': {
      const seconds = readNumber(1, ['value', 'seconds']);
      return self.startScriptTimer(
        readString(0, ['counterName', 'counter']),
        secondsToScriptTimerFrames(self, seconds),
      );
    }
    case 'SET_RANDOM_MSEC_TIMER': {
      const minSeconds = readNumber(1, ['value', 'minSeconds']);
      const maxSeconds = readNumber(2, ['randomValue', 'maxSeconds']);
      const seconds = resolveScriptRandomReal(self, minSeconds, maxSeconds);
      return self.startScriptTimer(
        readString(0, ['counterName', 'counter']),
        secondsToScriptTimerFrames(self, seconds),
      );
    }
    case 'ADD_TO_MSEC_TIMER': {
      const seconds = readNumber(0, ['value', 'seconds']);
      return self.addScriptCounter(
        readString(1, ['counterName', 'counter']),
        secondsToScriptTimerFrames(self, seconds),
      );
    }
    case 'SUB_FROM_MSEC_TIMER': {
      const seconds = readNumber(0, ['value', 'seconds']);
      return self.addScriptCounter(
        readString(1, ['counterName', 'counter']),
        secondsToScriptTimerFrames(self, -seconds),
      );
    }
    case 'TEAM_TRANSFER_TO_PLAYER':
      return self.transferScriptTeamToSide(
        readString(0, ['teamName', 'team']),
        readString(1, ['side', 'playerName', 'player']),
      );
    case 'TEAM_SET_OVERRIDE_RELATION_TO_TEAM':
      return setScriptTeamOverrideRelationToTeam(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['otherTeamName', 'otherTeam', 'targetTeam', 'target']),
        readRelationship(2, ['relationship', 'relation']),
      );
    case 'TEAM_REMOVE_OVERRIDE_RELATION_TO_TEAM':
      return self.removeScriptTeamOverrideRelationToTeam(
        readString(0, ['teamName', 'team']),
        readString(1, ['otherTeamName', 'otherTeam', 'targetTeam', 'target']),
      );
    case 'TEAM_REMOVE_ALL_OVERRIDE_RELATIONS':
      return self.removeScriptTeamAllOverrideRelations(
        readString(0, ['teamName', 'team']),
      );
    case 'TEAM_SET_OVERRIDE_RELATION_TO_PLAYER':
      return setScriptTeamOverrideRelationToPlayer(self, 
        readString(0, ['teamName', 'team']),
        readSide(1, ['otherPlayer', 'side', 'playerName', 'player']),
        readRelationship(2, ['relationship', 'relation']),
      );
    case 'TEAM_REMOVE_OVERRIDE_RELATION_TO_PLAYER':
      return self.removeScriptTeamOverrideRelationToPlayer(
        readString(0, ['teamName', 'team']),
        readSide(1, ['otherPlayer', 'side', 'playerName', 'player']),
      );
    case 'PLAYER_SET_OVERRIDE_RELATION_TO_TEAM':
      return setScriptPlayerOverrideRelationToTeam(self, 
        readSide(0, ['side', 'playerName', 'player']),
        readString(1, ['otherTeamName', 'otherTeam', 'targetTeam', 'target']),
        readRelationship(2, ['relationship', 'relation']),
      );
    case 'PLAYER_REMOVE_OVERRIDE_RELATION_TO_TEAM':
      return self.removeScriptPlayerOverrideRelationToTeam(
        readSide(0, ['side', 'playerName', 'player']),
        readString(1, ['otherTeamName', 'otherTeam', 'targetTeam', 'target']),
      );
    case 'PLAYER_RELATES_PLAYER': {
      const sourceSide = readSide(0, ['side', 'playerName', 'player', 'sourcePlayer']);
      const targetSide = readSide(1, ['otherPlayer', 'targetPlayer', 'targetSide']);
      const relationship = resolveScriptRelationshipInput(self, 
        readRelationship(2, ['relationship', 'relation']),
      );
      if (relationship === null) {
        return false;
      }
      if (!self.normalizeSide(sourceSide) || !self.normalizeSide(targetSide)) {
        return false;
      }
      self.setPlayerRelationship(sourceSide, targetSide, relationship);
      return true;
    }
    case 'CAMERA_TETHER_NAMED':
      return self.setScriptCameraTether(
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readInteger(1, ['immediate', 'snap', 'snapToUnit']) !== 0,
        readNumber(2, ['play', 'lockDistance', 'distance']),
      );
    case 'CAMERA_STOP_TETHER_NAMED':
      self.clearScriptCameraTether();
      return true;
    case 'CAMERA_SET_DEFAULT':
      return self.setScriptCameraDefaultView(
        readNumber(0, ['pitch']),
        readNumber(1, ['angle']),
        readNumber(2, ['maxHeight', 'height']),
      );
    case 'CAMERA_LOOK_TOWARD_OBJECT':
      return self.setScriptCameraLookTowardObject(
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readNumber(1, ['seconds', 'durationSeconds', 'duration']),
        readNumber(2, ['holdSeconds', 'hold']),
        readNumber(3, ['easeInSeconds', 'easeIn']),
        readNumber(4, ['easeOutSeconds', 'easeOut']),
      );
    case 'NAMED_FIRE_WEAPON_FOLLOWING_WAYPOINT_PATH':
      return executeScriptNamedFireWeaponFollowingWaypointPath(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['waypointPathName', 'waypointPathLabel', 'pathLabel', 'waypointPath']),
      );
    case 'UNIT_EXECUTE_SEQUENTIAL_SCRIPT':
      return executeScriptUnitExecuteSequentialScript(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['scriptName', 'script']),
        0,
      );
    case 'UNIT_EXECUTE_SEQUENTIAL_SCRIPT_LOOPING':
      return executeScriptUnitExecuteSequentialScript(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['scriptName', 'script']),
        readInteger(2, ['loopCount', 'timesToLoop', 'count']) - 1,
      );
    case 'UNIT_STOP_SEQUENTIAL_SCRIPT':
      return executeScriptUnitStopSequentialScript(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
      );
    case 'TEAM_EXECUTE_SEQUENTIAL_SCRIPT':
      return executeScriptTeamExecuteSequentialScript(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['scriptName', 'script']),
        0,
      );
    case 'TEAM_EXECUTE_SEQUENTIAL_SCRIPT_LOOPING':
      return executeScriptTeamExecuteSequentialScript(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['scriptName', 'script']),
        readInteger(2, ['loopCount', 'timesToLoop', 'count']) - 1,
      );
    case 'TEAM_STOP_SEQUENTIAL_SCRIPT':
      return executeScriptTeamStopSequentialScript(self, readString(0, ['teamName', 'team']));
    case 'UNIT_GUARD_FOR_FRAMECOUNT':
      return executeScriptUnitGuardForFramecount(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readInteger(1, ['frameCount', 'frames', 'waitFrames']),
      );
    case 'UNIT_IDLE_FOR_FRAMECOUNT':
      return executeScriptUnitIdleForFramecount(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readInteger(1, ['frameCount', 'frames', 'waitFrames']),
      );
    case 'TEAM_GUARD_FOR_FRAMECOUNT':
      // Source parity: ScriptActions::doAction switch routes TEAM_GUARD_FOR_FRAMECOUNT
      // to doTeamIdleForFramecount (legacy engine behavior).
      return executeScriptTeamIdleForFramecount(self, 
        readString(0, ['teamName', 'team']),
        readInteger(1, ['frameCount', 'frames', 'waitFrames']),
      );
    case 'TEAM_IDLE_FOR_FRAMECOUNT':
      return executeScriptTeamIdleForFramecount(self, 
        readString(0, ['teamName', 'team']),
        readInteger(1, ['frameCount', 'frames', 'waitFrames']),
      );
    case 'WATER_CHANGE_HEIGHT':
      return executeScriptWaterChangeHeight(self, 
        readString(0, ['triggerName', 'waterName', 'water']),
        readNumber(1, ['newHeight', 'height', 'value']),
      );
    case 'WATER_CHANGE_HEIGHT_OVER_TIME':
      return executeScriptWaterChangeHeightOverTime(self, 
        readString(0, ['triggerName', 'waterName', 'water']),
        readNumber(1, ['newHeight', 'height', 'value']),
        readNumber(2, ['seconds', 'time', 'duration']),
        readNumber(3, ['damage', 'damagePerSecond', 'damageAmount']),
      );
    case 'MAP_SWITCH_BORDER':
      return executeScriptMapSwitchBorder(self, 
        readInteger(0, ['border', 'boundary', 'borderIndex']),
      );
    case 'CAMERA_LOOK_TOWARD_WAYPOINT':
      return self.setScriptCameraLookTowardWaypoint(
        readString(0, ['waypointName', 'waypoint']),
        readNumber(1, ['seconds', 'durationSeconds', 'duration']),
        readNumber(2, ['easeInSeconds', 'easeIn']),
        readNumber(3, ['easeOutSeconds', 'easeOut']),
        readBoolean(4, ['reverseRotation', 'reverse']),
      );
    case 'TEAM_GUARD_POSITION':
      return executeScriptTeamGuardPosition(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['waypointName', 'waypoint']),
      );
    case 'TEAM_GUARD_OBJECT':
      return executeScriptTeamGuardObject(self, 
        readString(0, ['teamName', 'team']),
        readEntityId(1, ['targetEntityId', 'entityId', 'targetObjectId', 'unitId', 'named']),
      );
    case 'TEAM_GUARD_AREA':
      return executeScriptTeamGuardArea(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['triggerName', 'trigger', 'areaName', 'area']),
      );
    case 'NAMED_FACE_NAMED':
      return executeScriptNamedFaceNamed(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readEntityId(1, ['targetEntityId', 'entityId', 'targetObjectId', 'unitId', 'named']),
      );
    case 'NAMED_FACE_WAYPOINT':
      return executeScriptNamedFaceWaypoint(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['waypointName', 'waypoint']),
      );
    case 'TEAM_FACE_NAMED':
      return executeScriptTeamFaceNamed(self, 
        readString(0, ['teamName', 'team']),
        readEntityId(1, ['targetEntityId', 'entityId', 'targetObjectId', 'unitId', 'named']),
      );
    case 'TEAM_FACE_WAYPOINT':
      return executeScriptTeamFaceWaypoint(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['waypointName', 'waypoint']),
      );
    case 'OBJECT_FORCE_SELECT':
      return executeScriptObjectForceSelect(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['templateName', 'objectType', 'unitType']),
        readBoolean(2, ['centerInView', 'center']),
        readString(3, ['audioName', 'audio', 'sound']),
      );
    case 'UNIT_DESTROY_ALL_CONTAINED':
      return executeScriptUnitDestroyAllContained(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
      );
    case 'NAMED_SET_EVAC_LEFT_OR_RIGHT':
      return executeScriptNamedSetEvacLeftOrRight(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readInteger(1, ['leftOrRight', 'evacDisposition', 'value']),
      );
    case 'NAMED_SET_HELD':
      return executeScriptNamedSetHeld(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readBoolean(1, ['held', 'value', 'enabled']),
      );
    case 'SET_CAVE_INDEX':
      return executeScriptSetCaveIndex(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readInteger(1, ['caveIndex', 'index', 'value']),
      );
    case 'NAMED_SET_TOPPLE_DIRECTION': {
      const direction = coerceScriptConditionCoord3(self, 
        readValue(1, ['direction', 'dir', 'toppleDirection']),
      );
      return setScriptNamedToppleDirection(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        direction?.x ?? 0,
        direction?.y ?? 0,
      );
    }
    case 'UNIT_MOVE_TOWARDS_NEAREST_OBJECT_TYPE':
      return executeScriptMoveUnitTowardsNearestObjectType(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['objectType', 'templateName', 'type']),
        readString(2, ['triggerName', 'trigger', 'areaName', 'area']),
      );
    case 'TEAM_MOVE_TOWARDS_NEAREST_OBJECT_TYPE':
      return executeScriptMoveTeamTowardsNearestObjectType(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['objectType', 'templateName', 'type']),
        readString(2, ['triggerName', 'trigger', 'areaName', 'area']),
      );
    case 'MAP_REVEAL_AT_WAYPOINT':
      return executeScriptRevealMapAtWaypoint(self, 
        readString(0, ['waypointName', 'waypoint']),
        readNumber(1, ['radius', 'radiusToReveal']),
        readString(2, ['side', 'playerName', 'player']),
      );
    case 'MAP_SHROUD_AT_WAYPOINT':
      return executeScriptShroudMapAtWaypoint(self, 
        readString(0, ['waypointName', 'waypoint']),
        readNumber(1, ['radius', 'radiusToShroud']),
        readString(2, ['side', 'playerName', 'player']),
      );
    case 'MAP_REVEAL_ALL':
      return executeScriptRevealMapEntire(self, 
        readString(0, ['side', 'playerName', 'player']),
      );
    case 'MAP_REVEAL_ALL_PERM':
      return executeScriptRevealMapEntirePermanently(self, 
        true,
        readString(0, ['side', 'playerName', 'player']),
      );
    case 'MAP_REVEAL_ALL_UNDO_PERM':
      return executeScriptRevealMapEntirePermanently(self, 
        false,
        readString(0, ['side', 'playerName', 'player']),
      );
    case 'MAP_SHROUD_ALL':
      return executeScriptShroudMapEntire(self, 
        readString(0, ['side', 'playerName', 'player']),
      );
    case 'MAP_REVEAL_PERMANENTLY_AT_WAYPOINT':
      return executeScriptRevealMapAtWaypointPermanently(self, 
        readString(0, ['waypointName', 'waypoint']),
        readNumber(1, ['radius', 'radiusToReveal']),
        readSide(2, ['side', 'playerName', 'player']),
        readString(3, ['lookName', 'mapLookName', 'namedReveal']),
      );
    case 'MAP_UNDO_REVEAL_PERMANENTLY_AT_WAYPOINT':
      return executeScriptUndoRevealMapAtWaypointPermanently(self, 
        readString(0, ['lookName', 'mapLookName', 'namedReveal']),
      );
    case 'NAMED_SET_STEALTH_ENABLED':
      return executeScriptNamedSetStealthEnabled(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readBoolean(1, ['enabled', 'stealthEnabled', 'value']),
      );
    case 'TEAM_SET_STEALTH_ENABLED':
      return executeScriptTeamSetStealthEnabled(self, 
        readString(0, ['teamName', 'team']),
        readBoolean(1, ['enabled', 'stealthEnabled', 'value']),
      );
    case 'NAMED_SET_UNMANNED_STATUS':
      return executeScriptNamedSetUnmannedStatus(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
      );
    case 'TEAM_SET_UNMANNED_STATUS':
      return executeScriptTeamSetUnmannedStatus(self, 
        readString(0, ['teamName', 'team']),
      );
    case 'NAMED_SET_BOOBYTRAPPED':
      return executeScriptNamedSetBoobytrapped(self, 
        readString(0, ['templateName', 'objectType', 'object', 'thingTemplate']),
        readEntityId(1, ['entityId', 'unitId', 'named']),
      );
    case 'TEAM_SET_BOOBYTRAPPED':
      return executeScriptTeamSetBoobytrapped(self, 
        readString(0, ['templateName', 'objectType', 'object', 'thingTemplate']),
        readString(1, ['teamName', 'team']),
      );
    case 'EVA_SET_ENABLED_DISABLED':
      self.setScriptEvaEnabled(readBoolean(0, ['enabled', 'evaEnabled', 'value']));
      return true;
    case 'OPTIONS_SET_OCCLUSION_MODE':
      self.setScriptOcclusionModeEnabled(readBoolean(0, ['enabled', 'occlusionEnabled', 'value']));
      return true;
    case 'OPTIONS_SET_DRAWICON_UI_MODE':
      self.setScriptDrawIconUIEnabled(readBoolean(0, ['enabled', 'drawIconUIEnabled', 'value']));
      return true;
    case 'OPTIONS_SET_PARTICLE_CAP_MODE':
      self.setScriptDynamicLodEnabled(readBoolean(0, ['enabled', 'particleCapEnabled', 'value']));
      return true;
    case 'PLAYER_AFFECT_RECEIVING_EXPERIENCE':
      return self.setSideSkillPointsModifier(
        readSide(0, ['side', 'playerName', 'player']),
        readNumber(1, ['modifier', 'experienceModifier', 'value']),
      );
    case 'PLAYER_SELECT_SKILLSET':
      return self.setSideScriptSkillset(
        readSide(0, ['side', 'playerName', 'player']),
        readInteger(1, ['skillset', 'value']),
      );
    case 'SCRIPTING_OVERRIDE_HULK_LIFETIME':
      return setScriptHulkLifetimeOverrideSeconds(self, 
        readNumber(0, ['seconds', 'lifetimeSeconds', 'value']),
      );
    case 'COMMANDBAR_REMOVE_BUTTON_OBJECTTYPE':
      return executeScriptCommandBarRemoveButtonObjectType(self, 
        readString(0, ['buttonName', 'commandButton', 'button']),
        readString(1, ['templateName', 'objectType', 'object', 'thingTemplate']),
      );
    case 'COMMANDBAR_ADD_BUTTON_OBJECTTYPE_SLOT':
      return executeScriptCommandBarAddButtonObjectTypeSlot(self, 
        readString(0, ['buttonName', 'commandButton', 'button']),
        readString(1, ['templateName', 'objectType', 'object', 'thingTemplate']),
        readInteger(2, ['slotNum', 'slot', 'value']),
      );
    case 'UNIT_AFFECT_OBJECT_PANEL_FLAGS':
      return executeScriptAffectObjectPanelFlagsUnit(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['flagName', 'flag']),
        readBoolean(2, ['enabled', 'value']),
      );
    case 'TEAM_AFFECT_OBJECT_PANEL_FLAGS':
      return executeScriptAffectObjectPanelFlagsTeam(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['flagName', 'flag']),
        readBoolean(2, ['enabled', 'value']),
      );
    case 'NAMED_SET_REPULSOR':
      return executeScriptNamedSetRepulsor(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readBoolean(1, ['repulsor', 'value', 'enabled']),
      );
    case 'TEAM_SET_REPULSOR':
      return executeScriptTeamSetRepulsor(self, 
        readString(0, ['teamName', 'team']),
        readBoolean(1, ['repulsor', 'value', 'enabled']),
      );
    case 'TEAM_WANDER_IN_PLACE':
      return executeScriptTeamWanderInPlace(self, readString(0, ['teamName', 'team']));
    case 'TEAM_INCREASE_PRIORITY':
      return executeScriptTeamIncreasePriority(self, readString(0, ['teamName', 'team']));
    case 'TEAM_DECREASE_PRIORITY':
      return executeScriptTeamDecreasePriority(self, readString(0, ['teamName', 'team']));
    case 'NAMED_STOP':
      return executeScriptNamedStop(self, readEntityId(0, ['entityId', 'unitId', 'named']));
    case 'TEAM_STOP':
      return executeScriptTeamStop(self, readString(0, ['teamName', 'team']));
    case 'TEAM_STOP_AND_DISBAND':
      return executeScriptTeamStopAndDisband(self, readString(0, ['teamName', 'team']));
    case 'RECRUIT_TEAM':
      return executeScriptRecruitTeam(self, 
        readString(0, ['teamName', 'team']),
        readNumber(1, ['recruitRadius', 'radius']),
      );
    case 'PLAYER_SET_MONEY': {
      const sideInput = readString(0, ['side', 'playerName', 'player']);
      if (!setScriptCreditsForPlayerInput(self, sideInput, readInteger(1, ['value', 'amount', 'money']))) {
        return false;
      }
      return true;
    }
    case 'PLAYER_GIVE_MONEY': {
      const sideInput = readString(0, ['side', 'playerName', 'player']);
      if (self.addScriptCreditsForPlayerInput(sideInput, readInteger(1, ['value', 'amount', 'money'])) === null) {
        return false;
      }
      return true;
    }
    case 'PLAYER_ADD_SKILLPOINTS': {
      const side = readSide(0, ['side', 'playerName', 'player']);
      if (!self.normalizeSide(side)) {
        return false;
      }
      self.addPlayerSkillPoints(side, readInteger(1, ['value', 'amount', 'skillPoints']));
      return true;
    }
    case 'PLAYER_ADD_RANKLEVEL': {
      const side = readSide(0, ['side', 'playerName', 'player']);
      const normalizedSide = self.normalizeSide(side);
      if (!normalizedSide) {
        return false;
      }
      const rankState = self.getSideRankStateMap(normalizedSide);
      self.setSideRankLevelByNormalizedSide(
        normalizedSide,
        rankState.rankLevel + readInteger(1, ['value', 'amount', 'rankLevels']),
      );
      return true;
    }
    case 'PLAYER_SET_RANKLEVEL': {
      const side = readSide(0, ['side', 'playerName', 'player']);
      if (!self.normalizeSide(side)) {
        return false;
      }
      self.setSideRankLevel(side, readInteger(1, ['value', 'rankLevel']));
      return true;
    }
    case 'PLAYER_SET_RANKLEVELLIMIT':
      self.rankLevelLimit = Math.max(
        1,
        Math.min(RANK_TABLE.length, readInteger(0, ['value', 'rankLevelLimit'])),
      );
      return true;
    case 'PLAYER_GRANT_SCIENCE':
      return grantScriptScienceForPlayerInput(self, 
        readString(0, ['side', 'playerName', 'player']),
        readString(1, ['scienceName', 'science']),
      );
    case 'PLAYER_PURCHASE_SCIENCE': {
      return purchaseScriptScienceForPlayerInput(self, 
        readString(0, ['side', 'playerName', 'player']),
        readString(1, ['scienceName', 'science']),
      );
    }
    case 'TEAM_HUNT_WITH_COMMAND_BUTTON':
      return executeScriptTeamHuntWithCommandButton(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['abilityName', 'ability', 'commandButtonName', 'commandButton']),
      );
    case 'TEAM_SET_EMOTICON':
      return executeScriptTeamSetEmoticon(self, 
        readString(0, ['teamName', 'team']),
        readString(1, ['emoticonName', 'emoticon']),
        readNumber(2, ['durationSeconds', 'seconds', 'duration', 'timeInSeconds']),
      );
    case 'NAMED_SET_EMOTICON':
      return executeScriptNamedSetEmoticon(self, 
        readEntityId(0, ['entityId', 'unitId', 'named']),
        readString(1, ['emoticonName', 'emoticon']),
        readNumber(2, ['durationSeconds', 'seconds', 'duration', 'timeInSeconds']),
      );
    case 'OBJECTLIST_ADDOBJECTTYPE':
      return executeScriptObjectTypeListMaintenance(self, 
        readString(0, ['listName', 'objectList', 'objectListName']),
        readString(1, ['templateName', 'objectType', 'object', 'thingTemplate']),
        true,
      );
    case 'OBJECTLIST_REMOVEOBJECTTYPE':
      return executeScriptObjectTypeListMaintenance(self, 
        readString(0, ['listName', 'objectList', 'objectListName']),
        readString(1, ['templateName', 'objectType', 'object', 'thingTemplate']),
        false,
      );
    case 'PLAYER_SCIENCE_AVAILABILITY':
      return self.setSideScienceAvailability(
        readSide(0, ['side', 'playerName', 'player']),
        readString(1, ['scienceName', 'science']),
        readString(2, ['availability', 'scienceAvailability', 'value']),
      );
    default:
      return false;
  }
}

export function resolveScriptTeamSidesForRelationship(self: GL, teamName: string): string[] {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return [];
  }

  const side = resolveScriptTeamControllingSide(self, team);
  if (!side) {
    return [];
  }
  return [side];
}

export function setScriptTeamOverrideRelationToTeam(self: GL, 
  teamName: string,
  otherTeamName: string,
  relationshipInput: ScriptRelationshipInput,
): boolean {
  const relationship = resolveScriptRelationshipInput(self, relationshipInput);
  if (relationship === null) {
    return false;
  }

  const sourceSides = resolveScriptTeamSidesForRelationship(self, teamName);
  const targetSides = resolveScriptTeamSidesForRelationship(self, otherTeamName);
  if (sourceSides.length === 0 || targetSides.length === 0) {
    return false;
  }

  for (const sourceSide of sourceSides) {
    for (const targetSide of targetSides) {
      self.setTeamRelationship(sourceSide, targetSide, relationship);
    }
  }
  return true;
}

export function setScriptTeamOverrideRelationToPlayer(self: GL, 
  teamName: string,
  playerSide: string,
  relationshipInput: ScriptRelationshipInput,
): boolean {
  const sourceSides = resolveScriptTeamSidesForRelationship(self, teamName);
  const targetSide = self.normalizeSide(playerSide);
  if (sourceSides.length === 0 || !targetSide) {
    return false;
  }
  const relationship = resolveScriptRelationshipInput(self, relationshipInput);
  if (relationship === null) {
    return false;
  }

  for (const sourceSide of sourceSides) {
    self.setTeamRelationship(sourceSide, targetSide, relationship);
  }
  return true;
}

export function setScriptPlayerOverrideRelationToTeam(self: GL, 
  playerSide: string,
  otherTeamName: string,
  relationshipInput: ScriptRelationshipInput,
): boolean {
  const sourceSide = self.normalizeSide(playerSide);
  const targetSides = resolveScriptTeamSidesForRelationship(self, otherTeamName);
  if (!sourceSide || targetSides.length === 0) {
    return false;
  }
  const relationship = resolveScriptRelationshipInput(self, relationshipInput);
  if (relationship === null) {
    return false;
  }

  for (const targetSide of targetSides) {
    self.setPlayerRelationship(sourceSide, targetSide, relationship);
  }
  return true;
}

export function normalizeScriptCommandTypeName(self: GL, commandTypeName: string): string {
  const normalized = self.normalizeCommandTypeNameForBuildCheck(commandTypeName);
  if (normalized.startsWith('GUICOMMANDMODE_')) {
    return normalized.slice('GUICOMMANDMODE_'.length);
  }
  return normalized;
}

export function resolveScriptCommandButtonOptionMask(self: GL, commandButtonDef: CommandButtonDef): number {
  let optionMask = 0;

  const optionNames = commandButtonDef.options.length > 0
    ? commandButtonDef.options
    : self.extractIniValueTokens(commandButtonDef.fields['Options']).flatMap((entry) => entry);

  for (const optionName of optionNames) {
    const normalizedOptionName = optionName.trim().toUpperCase();
    if (!normalizedOptionName) {
      continue;
    }
    const mask = SCRIPT_COMMAND_OPTION_NAME_TO_MASK.get(normalizedOptionName);
    if (mask !== undefined) {
      optionMask |= mask;
    }
  }

  return optionMask;
}

export function resolveScriptWeaponSlotFromCommandButton(self: GL, commandButtonDef: CommandButtonDef): number | null {
  const weaponSlotToken = readStringField(commandButtonDef.fields, ['WeaponSlot'])?.trim().toUpperCase() ?? '';
  switch (weaponSlotToken) {
    case 'PRIMARY':
    case 'PRIMARY_WEAPON':
      return 0;
    case 'SECONDARY':
    case 'SECONDARY_WEAPON':
      return 1;
    case 'TERTIARY':
    case 'TERTIARY_WEAPON':
      return 2;
    default:
      break;
  }

  const numericSlot = readNumericField(commandButtonDef.fields, ['WeaponSlot']);
  if (numericSlot === null || !Number.isFinite(numericSlot)) {
    return null;
  }

  const slot = Math.trunc(numericSlot);
  if (slot < 0 || slot > 2) {
    return null;
  }
  return slot;
}

export function resolveScriptMaxShotsToFireFromCommandButton(self: GL, commandButtonDef: CommandButtonDef): number {
  const maxShots = readNumericField(commandButtonDef.fields, ['MaxShotsToFire']);
  if (maxShots === null || !Number.isFinite(maxShots)) {
    return SOURCE_DEFAULT_MAX_SHOTS_TO_FIRE;
  }
  return Math.trunc(maxShots);
}

export function resolveScriptCommandButtonTemplateName(self: GL, commandButtonDef: CommandButtonDef): string | null {
  const templateName = readStringField(commandButtonDef.fields, ['Object'])
    ?? readStringField(commandButtonDef.fields, ['ThingTemplate']);
  if (!templateName) {
    return null;
  }
  return templateName;
}

export function resolveScriptCommandButtonUpgradeName(self: GL, commandButtonDef: CommandButtonDef): string | null {
  const upgradeName = readStringField(commandButtonDef.fields, ['Upgrade']);
  if (!upgradeName) {
    return null;
  }
  return upgradeName;
}

export function resolveScriptScienceSideInputForEntity(self: GL, sourceEntity: MapEntity): string {
  const controllingPlayerToken = self.resolveEntityControllingPlayerTokenForAffiliation(sourceEntity);
  if (controllingPlayerToken) {
    return controllingPlayerToken;
  }
  return sourceEntity.side ?? '';
}

export function resolveScriptCommandButtonPurchasableScienceName(self: GL, 
  sourceEntity: MapEntity,
  commandButtonDef: CommandButtonDef,
): string | null {
  const sideInput = resolveScriptScienceSideInputForEntity(self, sourceEntity);
  const scienceNames = self.extractIniValueTokens(commandButtonDef.fields['Science']).flatMap((entry) => entry);
  for (const scienceName of scienceNames) {
    const normalizedScienceName = scienceName.trim().toUpperCase();
    if (!normalizedScienceName || normalizedScienceName === 'NONE') {
      continue;
    }
    const canonicalScienceName = self.resolveScienceInternalName(normalizedScienceName);
    if (!canonicalScienceName) {
      continue;
    }
    if (!self.canScriptPlayerPurchaseScience(sideInput, canonicalScienceName)) {
      continue;
    }
    return canonicalScienceName;
  }
  return null;
}

export function resolveScriptCommandButtonSpecialPowerName(self: GL, commandButtonDef: CommandButtonDef): string | null {
  const rawName = readStringField(commandButtonDef.fields, ['SpecialPower'])
    ?? readStringField(commandButtonDef.fields, ['SpecialPowerTemplate'])
    ?? '';
  const normalized = self.normalizeShortcutSpecialPowerName(rawName);
  return normalized || null;
}

export function resolveScriptCommandButtonSharedSpecialPowerReadyFrame(self: GL, specialPowerName: string): number {
  return resolveSharedShortcutSpecialPowerReadyFrameImpl(
    specialPowerName,
    self.frameCounter,
    self.sharedShortcutSpecialPowerReadyFrames,
    self.normalizeShortcutSpecialPowerName.bind(this),
  );
}

export function resolveScriptSpecialPowerCommandButtonExecution(self: GL, 
  sourceEntity: MapEntity,
  commandButtonDef: CommandButtonDef,
): {
  specialPowerName: string;
  normalizedSpecialPowerName: string;
  commandOption: number;
} | null {
  const specialPowerName = readStringField(commandButtonDef.fields, ['SpecialPower'])
    ?? readStringField(commandButtonDef.fields, ['SpecialPowerTemplate'])
    ?? '';
  const normalizedSpecialPowerName = self.normalizeShortcutSpecialPowerName(specialPowerName);
  if (!specialPowerName || !normalizedSpecialPowerName) {
    return null;
  }
  const specialPowerDef = self.resolveSpecialPowerDefByName(normalizedSpecialPowerName);
  if (!specialPowerDef) {
    return null;
  }
  if (!sourceEntity.specialPowerModules.has(normalizedSpecialPowerName)) {
    return null;
  }

  const commandOption = resolveScriptCommandButtonOptionMask(self, commandButtonDef);
  const isSharedSynced = readBooleanField(specialPowerDef.fields, ['SharedSyncedTimer']) === true;
  const readyFrame = isSharedSynced
    ? resolveScriptCommandButtonSharedSpecialPowerReadyFrame(self, normalizedSpecialPowerName)
    : self.resolveSpecialPowerReadyFrameForSourceEntity(normalizedSpecialPowerName, sourceEntity.id);
  if (self.frameCounter < readyFrame) {
    return null;
  }

  return {
    specialPowerName,
    normalizedSpecialPowerName,
    commandOption,
  };
}

export function resolveScriptCommandButtonHuntMode(self: GL, commandButtonDef: CommandButtonDef): CommandButtonHuntMode {
  const commandTypeName = normalizeScriptCommandTypeName(self, 
    commandButtonDef.commandTypeName
    ?? readStringField(commandButtonDef.fields, ['Command'])
    ?? '',
  );
  if (!commandTypeName) {
    return 'NONE';
  }

  switch (commandTypeName) {
    case 'SPECIAL_POWER':
    case 'SPECIAL_POWER_FROM_COMMAND_CENTER':
    case 'SPECIAL_POWER_FROM_SHORTCUT':
    case 'SPECIAL_POWER_CONSTRUCT':
    case 'SPECIAL_POWER_CONSTRUCT_FROM_SHORTCUT': {
      const specialPowerName = resolveScriptCommandButtonSpecialPowerName(self, commandButtonDef);
      if (!specialPowerName) {
        return 'NONE';
      }
      const commandOption = resolveScriptCommandButtonOptionMask(self, commandButtonDef);
      return (commandOption & SCRIPT_COMMAND_OPTION_NEED_OBJECT_TARGET) !== 0
        ? 'SPECIAL_POWER'
        : 'NONE';
    }
    case 'SWITCH_WEAPON':
    case 'FIRE_WEAPON':
      return 'WEAPON';
    case 'HIJACK_VEHICLE':
      return 'ENTER_HIJACK';
    case 'CONVERT_TO_CARBOMB':
      return 'ENTER_CARBOMB';
    case 'SABOTAGE_BUILDING':
      return 'ENTER_SABOTAGE';
    default:
      return 'NONE';
  }
}

export function executeScriptTeamHuntWithCommandButton(self: GL, teamName: string, commandButtonName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  const registry = self.iniDataRegistry;
  if (!team || !registry) {
    return false;
  }

  const commandButtonDef = findCommandButtonDefByName(registry, commandButtonName);
  if (!commandButtonDef) {
    return false;
  }

  const huntMode = resolveScriptCommandButtonHuntMode(self, commandButtonDef);
  if (huntMode === 'NONE') {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    if (!entity.commandButtonHuntProfile) {
      continue;
    }
    const commandButtons = findScriptEntityCommandButtonsByName(self, entity, commandButtonDef.name);
    if (commandButtons.length === 0) {
      continue;
    }
    self.activateCommandButtonHuntForEntity(entity, commandButtonDef.name, huntMode);
  }

  return true;
}

export function findScriptEntityCommandButtonsByName(self: GL, 
  sourceEntity: MapEntity,
  commandButtonName: string,
): CommandButtonDef[] {
  const registry = self.iniDataRegistry;
  if (!registry) {
    return [];
  }

  const sourceObjectDef = findObjectDefByName(registry, sourceEntity.templateName);
  if (!sourceObjectDef) {
    return [];
  }
  const commandSetName = self.resolveEntityCommandSetName(sourceEntity, sourceObjectDef);
  if (!commandSetName) {
    return [];
  }
  const commandSetDef = findCommandSetDefByName(registry, commandSetName);
  if (!commandSetDef) {
    return [];
  }

  const normalizedCommandButtonName = commandButtonName.trim().toUpperCase();
  if (!normalizedCommandButtonName) {
    return [];
  }

  const matches: CommandButtonDef[] = [];
  for (let buttonSlot = 1; buttonSlot <= 18; buttonSlot += 1) {
    const slottedCommandButtonName = self.resolveCommandSetSlotButtonName(commandSetDef, buttonSlot);
    if (!slottedCommandButtonName) {
      continue;
    }
    const commandButtonDef = findCommandButtonDefByName(registry, slottedCommandButtonName);
    if (!commandButtonDef) {
      continue;
    }
    if (commandButtonDef.name.trim().toUpperCase() !== normalizedCommandButtonName) {
      continue;
    }
    matches.push(commandButtonDef);
  }

  return matches;
}

export function executeScriptCommandButtonForEntity(self: GL, 
  sourceEntity: MapEntity,
  commandButtonDef: CommandButtonDef,
  target: ScriptCommandButtonTarget,
  validateOnly = false,
): boolean {
  const commandTypeName = normalizeScriptCommandTypeName(self, 
    commandButtonDef.commandTypeName
    ?? readStringField(commandButtonDef.fields, ['Command'])
    ?? '',
  );
  if (!commandTypeName) {
    return false;
  }
  if (self.isEntityDisabledForScriptCommandButton(sourceEntity)) {
    return false;
  }

  switch (commandTypeName) {
    case 'SPECIAL_POWER':
    case 'SPECIAL_POWER_FROM_COMMAND_CENTER':
    case 'SPECIAL_POWER_FROM_SHORTCUT':
    case 'SPECIAL_POWER_CONSTRUCT':
    case 'SPECIAL_POWER_CONSTRUCT_FROM_SHORTCUT': {
      const validated = self.validateScriptSpecialPowerCommandButtonExecution(sourceEntity, commandButtonDef, target);
      if (!validated) {
        return false;
      }

      let targetEntityId: number | null = null;
      let targetX: number | null = null;
      let targetZ: number | null = null;
      if (target.kind === 'OBJECT') {
        targetEntityId = target.targetEntity.id;
      } else if (target.kind === 'POSITION') {
        targetX = target.targetX;
        targetZ = target.targetZ;
      }

      if (validateOnly) {
        return true;
      }

      self.applyCommand({
        type: 'issueSpecialPower',
        commandSource: 'SCRIPT',
        commandButtonId: commandButtonDef.name,
        specialPowerName: validated.specialPowerName,
        commandOption: validated.commandOption,
        issuingEntityIds: [sourceEntity.id],
        sourceEntityId: sourceEntity.id,
        targetEntityId,
        targetX,
        targetZ,
      });
      return true;
    }
    case 'OBJECT_UPGRADE':
    case 'PLAYER_UPGRADE': {
      // Source parity: C++ doCommandButtonAtObject/AtPosition explicitly does NOT implement
      // these for OBJECT/POSITION targets (falls through to DEBUG_CRASH). Only NONE works.
      if (target.kind !== 'NONE') {
        return false;
      }
      const upgradeName = resolveScriptCommandButtonUpgradeName(self, commandButtonDef);
      if (!upgradeName) {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({
        type: 'queueUpgradeProduction',
        entityId: sourceEntity.id,
        upgradeName,
      });
      return true;
    }
    case 'PURCHASE_SCIENCE': {
      if (target.kind !== 'NONE') {
        return false;
      }
      const scienceName = resolveScriptCommandButtonPurchasableScienceName(self, sourceEntity, commandButtonDef);
      if (!scienceName) {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      const sideInput = resolveScriptScienceSideInputForEntity(self, sourceEntity);
      return purchaseScriptScienceForPlayerInput(self, sideInput, scienceName);
    }
    case 'UNIT_BUILD':
    case 'DOZER_CONSTRUCT': {
      const templateName = resolveScriptCommandButtonTemplateName(self, commandButtonDef);
      if (!templateName) {
        return false;
      }

      if (target.kind === 'POSITION') {
        if (commandTypeName !== 'DOZER_CONSTRUCT') {
          return false;
        }
        if (validateOnly) {
          return true;
        }
        self.applyCommand({
          type: 'constructBuilding',
          entityId: sourceEntity.id,
          templateName,
          targetPosition: [target.targetX, 0, target.targetZ],
          angle: 0,
          lineEndPosition: null,
        });
        return true;
      }

      if (target.kind !== 'NONE') {
        return false;
      }

      if (validateOnly) {
        return true;
      }

      self.applyCommand({
        type: 'queueUnitProduction',
        entityId: sourceEntity.id,
        unitTemplateName: templateName,
      });
      return true;
    }
    case 'STOP':
      if (validateOnly) {
        return true;
      }
      self.applyCommand({ type: 'stop', entityId: sourceEntity.id, commandSource: 'SCRIPT' });
      return true;
    case 'ATTACK_MOVE':
      if (target.kind !== 'POSITION') {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({
        type: 'attackMoveTo',
        entityId: sourceEntity.id,
        targetX: target.targetX,
        targetZ: target.targetZ,
        attackDistance: self.resolveAttackMoveDistance(sourceEntity),
        commandSource: 'SCRIPT',
      });
      return true;
    case 'SET_RALLY_POINT': {
      let targetX: number;
      let targetZ: number;
      if (target.kind === 'OBJECT') {
        const targetPosition = self.getEntityWorldPosition(target.targetEntity.id);
        if (!targetPosition) {
          return false;
        }
        targetX = targetPosition[0];
        targetZ = targetPosition[2];
      } else if (target.kind === 'POSITION') {
        targetX = target.targetX;
        targetZ = target.targetZ;
      } else {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({
        type: 'setRallyPoint',
        entityId: sourceEntity.id,
        targetX,
        targetZ,
      });
      return true;
    }
    case 'GUARD':
    case 'GUARD_WITHOUT_PURSUIT':
    case 'GUARD_FLYING_UNITS_ONLY': {
      const guardMode = commandTypeName === 'GUARD_WITHOUT_PURSUIT'
        ? 1
        : commandTypeName === 'GUARD_FLYING_UNITS_ONLY'
        ? 2
        : 0;
      if (target.kind === 'OBJECT') {
        if (validateOnly) {
          return true;
        }
        self.applyCommand({
          type: 'guardObject',
          entityId: sourceEntity.id,
          targetEntityId: target.targetEntity.id,
          guardMode,
          commandSource: 'SCRIPT',
        });
        return true;
      }
      if (target.kind === 'POSITION') {
        if (validateOnly) {
          return true;
        }
        self.applyCommand({
          type: 'guardPosition',
          entityId: sourceEntity.id,
          targetX: target.targetX,
          targetZ: target.targetZ,
          guardMode,
          commandSource: 'SCRIPT',
        });
        return true;
      }
      return false;
    }
    case 'FIRE_WEAPON': {
      const weaponSlot = resolveScriptWeaponSlotFromCommandButton(self, commandButtonDef) ?? 0;
      const maxShotsToFire = resolveScriptMaxShotsToFireFromCommandButton(self, commandButtonDef);
      const commandOption = resolveScriptCommandButtonOptionMask(self, commandButtonDef);
      const needsObjectTarget = (commandOption & SCRIPT_COMMAND_OPTION_NEED_OBJECT_TARGET) !== 0;
      const needsTargetPosition = (commandOption & SCRIPT_COMMAND_OPTION_NEED_TARGET_POS) !== 0;
      const attacksObjectPosition = (commandOption & SCRIPT_COMMAND_OPTION_ATTACK_OBJECTS_POSITION) !== 0;

      let targetObjectId: number | null = null;
      let targetPosition: readonly [number, number, number] | null = null;

      // Source parity: GeneralsMD Object::doCommandButton{,AtObject,AtPosition} gates FIRE_WEAPON
      // execution by command options + invocation target context.
      if (target.kind === 'NONE') {
        if (needsObjectTarget || needsTargetPosition) {
          return false;
        }
      } else if (target.kind === 'OBJECT') {
        if (!needsObjectTarget) {
          return false;
        }
        if (!isSpecialPowerObjectRelationshipAllowed(commandOption, self.getTeamRelationship(sourceEntity, target.targetEntity))) {
          return false;
        }
        targetObjectId = target.targetEntity.id;
        if (attacksObjectPosition) {
          targetPosition = self.getEntityWorldPosition(targetObjectId);
          if (!targetPosition) {
            return false;
          }
        }
      } else {
        if (!needsTargetPosition) {
          return false;
        }
        targetPosition = [target.targetX, 0, target.targetZ];
      }

      if (validateOnly) {
        return true;
      }

      self.applyCommand({
        type: 'fireWeapon',
        entityId: sourceEntity.id,
        weaponSlot,
        maxShotsToFire,
        targetObjectId,
        targetPosition,
      });
      return true;
    }
    case 'SWITCH_WEAPON': {
      // Source parity: C++ doCommandButtonAtObject/AtPosition explicitly does NOT implement
      // SWITCH_WEAPON for OBJECT/POSITION targets. Only NONE works.
      if (target.kind !== 'NONE') {
        return false;
      }
      const weaponSlot = resolveScriptWeaponSlotFromCommandButton(self, commandButtonDef);
      if (weaponSlot === null) {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({
        type: 'switchWeapon',
        entityId: sourceEntity.id,
        weaponSlot,
      });
      return true;
    }
    case 'HACK_INTERNET':
      // Source parity: C++ doCommandButtonAtObject/AtPosition explicitly does NOT implement
      // HACK_INTERNET for OBJECT/POSITION targets. Only NONE works.
      if (target.kind !== 'NONE') {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({ type: 'hackInternet', entityId: sourceEntity.id });
      return true;
    case 'TOGGLE_OVERCHARGE':
      if (target.kind !== 'NONE') {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({ type: 'toggleOvercharge', entityId: sourceEntity.id });
      return true;
    case 'EXIT_CONTAINER':
      if (target.kind !== 'NONE') {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({ type: 'exitContainer', entityId: sourceEntity.id });
      return true;
    case 'EVACUATE':
      if (target.kind !== 'NONE') {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({ type: 'evacuate', entityId: sourceEntity.id });
      return true;
    case 'EXECUTE_RAILED_TRANSPORT':
      if (target.kind !== 'NONE') {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({ type: 'executeRailedTransport', entityId: sourceEntity.id });
      return true;
    case 'BEACON_DELETE':
      if (target.kind !== 'NONE') {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({ type: 'beaconDelete', entityId: sourceEntity.id });
      return true;
    case 'DOZER_CONSTRUCT_CANCEL':
      if (target.kind !== 'NONE') {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({ type: 'cancelDozerConstruction', entityId: sourceEntity.id });
      return true;
    case 'CANCEL_UNIT_BUILD': {
      if (target.kind !== 'NONE') {
        return false;
      }
      const queuedUnit = sourceEntity.productionQueue.find((entry) => entry.type === 'UNIT');
      if (!queuedUnit) {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({
        type: 'cancelUnitProduction',
        entityId: sourceEntity.id,
        productionId: queuedUnit.productionId,
      });
      return true;
    }
    case 'CANCEL_UPGRADE': {
      if (target.kind !== 'NONE') {
        return false;
      }
      let upgradeName = resolveScriptCommandButtonUpgradeName(self, commandButtonDef)?.trim().toUpperCase() ?? '';
      if (upgradeName === 'NONE') {
        upgradeName = '';
      }
      if (!upgradeName) {
        const queuedUpgrade = sourceEntity.productionQueue.find((entry) => entry.type === 'UPGRADE');
        if (!queuedUpgrade) {
          return false;
        }
        upgradeName = queuedUpgrade.upgradeName;
      } else {
        const hasQueuedUpgrade = sourceEntity.productionQueue.some(
          (entry) => entry.type === 'UPGRADE' && entry.upgradeName === upgradeName,
        );
        if (!hasQueuedUpgrade) {
          return false;
        }
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({
        type: 'cancelUpgradeProduction',
        entityId: sourceEntity.id,
        upgradeName,
      });
      return true;
    }
    case 'WAYPOINTS':
      // Source parity: GeneralsMD Object::doCommandButton{,AtObject,AtPosition}
      // does not implement these command-button types for script execution.
      return false;
    case 'POW_RETURN_TO_PRISON':
    case 'PICK_UP_PRISONER':
      // Source parity: ALLOW_SURRENDER-only command modes are not script-implemented
      // in standard Generals/ZH builds; treat as unsupported in this port.
      return false;
    case 'SELL':
      // Source parity: C++ doCommandButtonAtObject/AtPosition explicitly does NOT implement
      // SELL for OBJECT/POSITION targets. Only NONE works.
      if (target.kind !== 'NONE') {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({ type: 'sell', entityId: sourceEntity.id });
      return true;
    case 'COMBATDROP': {
      if (target.kind === 'NONE') {
        // Source parity: no-target combat drop uses entity's current position.
        const pos = self.getEntityWorldPosition(sourceEntity.id);
        if (!pos) return false;
        if (validateOnly) return true;
        self.applyCommand({
          type: 'combatDrop',
          entityId: sourceEntity.id,
          targetObjectId: null,
          targetPosition: pos,
          commandSource: 'SCRIPT',
        });
        return true;
      }
      if (target.kind === 'POSITION') {
        if (validateOnly) return true;
        self.applyCommand({
          type: 'combatDrop',
          entityId: sourceEntity.id,
          targetObjectId: null,
          targetPosition: [target.targetX, 0, target.targetZ],
          commandSource: 'SCRIPT',
        });
        return true;
      }
      const targetObjectId = target.targetEntity.id;
      const targetPosition = self.getEntityWorldPosition(targetObjectId);
      if (!targetPosition) {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({
        type: 'combatDrop',
        entityId: sourceEntity.id,
        targetObjectId,
        targetPosition,
        commandSource: 'SCRIPT',
      });
      return true;
    }
    case 'HIJACK_VEHICLE':
    case 'CONVERT_TO_CARBOMB':
    case 'SABOTAGE_BUILDING':
      if (target.kind !== 'OBJECT') {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({
        type: 'enterObject',
        entityId: sourceEntity.id,
        targetObjectId: target.targetEntity.id,
        commandSource: 'SCRIPT',
        action: commandTypeName === 'HIJACK_VEHICLE'
          ? 'hijackVehicle'
          : commandTypeName === 'CONVERT_TO_CARBOMB'
          ? 'convertToCarBomb'
          : 'sabotageBuilding',
      });
      return true;
    case 'PLACE_BEACON': {
      let targetX: number;
      let targetZ: number;
      if (target.kind === 'OBJECT') {
        const targetPosition = self.getEntityWorldPosition(target.targetEntity.id);
        if (!targetPosition) {
          return false;
        }
        targetX = targetPosition[0];
        targetZ = targetPosition[2];
      } else if (target.kind === 'POSITION') {
        targetX = target.targetX;
        targetZ = target.targetZ;
      } else {
        return false;
      }
      if (validateOnly) {
        return true;
      }
      self.applyCommand({
        type: 'placeBeacon',
        targetPosition: [targetX, 0, targetZ],
      });
      return true;
    }
    default:
      // Source parity gap: unknown command button types are currently unsupported.
      return false;
  }
}

export function executeScriptNamedUseCommandButtonAbility(self: GL, entityId: number, commandButtonName: string): boolean {
  const sourceEntity = self.spawnedEntities.get(entityId);
  if (!sourceEntity || sourceEntity.destroyed) {
    return false;
  }

  const commandButtons = findScriptEntityCommandButtonsByName(self, sourceEntity, commandButtonName);
  if (commandButtons.length === 0) {
    return false;
  }

  let executed = false;
  for (const commandButtonDef of commandButtons) {
    if (executeScriptCommandButtonForEntity(self, sourceEntity, commandButtonDef, { kind: 'NONE' })) {
      executed = true;
    }
  }
  return executed;
}

export function executeScriptNamedUseCommandButtonAbilityOnNamed(self: GL, 
  entityId: number,
  commandButtonName: string,
  targetEntityId: number,
): boolean {
  const sourceEntity = self.spawnedEntities.get(entityId);
  const targetEntity = self.spawnedEntities.get(targetEntityId);
  if (!sourceEntity || sourceEntity.destroyed || !targetEntity || targetEntity.destroyed) {
    return false;
  }

  const commandButtons = findScriptEntityCommandButtonsByName(self, sourceEntity, commandButtonName);
  if (commandButtons.length === 0) {
    return false;
  }

  let executed = false;
  for (const commandButtonDef of commandButtons) {
    if (executeScriptCommandButtonForEntity(self, sourceEntity, commandButtonDef, {
      kind: 'OBJECT',
      targetEntity,
    })) {
      executed = true;
    }
  }
  return executed;
}

export function executeScriptNamedUseCommandButtonAbilityAtWaypoint(self: GL, 
  entityId: number,
  commandButtonName: string,
  waypointName: string,
): boolean {
  const sourceEntity = self.spawnedEntities.get(entityId);
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  if (!sourceEntity || sourceEntity.destroyed || !waypoint) {
    return false;
  }

  const commandButtons = findScriptEntityCommandButtonsByName(self, sourceEntity, commandButtonName);
  if (commandButtons.length === 0) {
    return false;
  }

  let executed = false;
  for (const commandButtonDef of commandButtons) {
    if (executeScriptCommandButtonForEntity(self, sourceEntity, commandButtonDef, {
      kind: 'POSITION',
      targetX: waypoint.x,
      targetZ: waypoint.z,
    })) {
      executed = true;
    }
  }
  return executed;
}

export function executeScriptNamedUseCommandButtonAbilityUsingWaypointPath(self: GL, 
  entityId: number,
  commandButtonName: string,
  waypointPathName: string,
): boolean {
  const sourceEntity = self.spawnedEntities.get(entityId);
  if (!sourceEntity || sourceEntity.destroyed) {
    return false;
  }
  if (self.isEntityDisabledForScriptCommandButton(sourceEntity)) {
    return false;
  }

  // Source parity: ScriptActions::doNamedUseCommandButtonAbilityUsingWaypointPath
  // uses TerrainLogic::getClosestWaypointOnPath. Our route resolver returns the
  // closest matching waypoint as the first node.
  const route = resolveScriptWaypointRouteByPathLabel(self, 
    waypointPathName,
    sourceEntity.x,
    sourceEntity.z,
    true,
  );
  if (!route || route.length === 0) {
    return false;
  }

  const commandButtons = findScriptEntityCommandButtonsByName(self, sourceEntity, commandButtonName);
  if (commandButtons.length === 0) {
    return false;
  }

  const closestWaypoint = route[0]!;
  let executed = false;
  for (const commandButtonDef of commandButtons) {
    const commandTypeName = normalizeScriptCommandTypeName(self, 
      commandButtonDef.commandTypeName
      ?? readStringField(commandButtonDef.fields, ['Command'])
      ?? '',
    );
    if (
      commandTypeName !== 'SPECIAL_POWER'
      && commandTypeName !== 'SPECIAL_POWER_FROM_COMMAND_CENTER'
      && commandTypeName !== 'SPECIAL_POWER_FROM_SHORTCUT'
      && commandTypeName !== 'SPECIAL_POWER_CONSTRUCT'
      && commandTypeName !== 'SPECIAL_POWER_CONSTRUCT_FROM_SHORTCUT'
    ) {
      continue;
    }

    const resolved = resolveScriptSpecialPowerCommandButtonExecution(self, sourceEntity, commandButtonDef);
    if (!resolved) {
      continue;
    }
    if ((resolved.commandOption & SCRIPT_COMMAND_OPTION_CAN_USE_WAYPOINTS) === 0) {
      continue;
    }
    // Source parity: doCommandButtonUsingWaypoints does not provide an object target context.
    // Object-target special powers cannot execute through this script action.
    if ((resolved.commandOption & SCRIPT_COMMAND_OPTION_NEED_OBJECT_TARGET) !== 0) {
      continue;
    }
    const usesPositionTarget = (resolved.commandOption & SCRIPT_COMMAND_OPTION_NEED_TARGET_POS) !== 0;

    self.applyCommand({
      type: 'issueSpecialPower',
      commandSource: 'SCRIPT',
      commandButtonId: commandButtonDef.name,
      specialPowerName: resolved.specialPowerName,
      commandOption: resolved.commandOption,
      issuingEntityIds: [sourceEntity.id],
      sourceEntityId: sourceEntity.id,
      targetEntityId: null,
      targetX: usesPositionTarget ? closestWaypoint.x : null,
      targetZ: usesPositionTarget ? closestWaypoint.z : null,
    });
    executed = true;
  }

  return executed;
}

export function executeScriptTeamUseCommandButtonAbility(self: GL, teamName: string, commandButtonName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  const registry = self.iniDataRegistry;
  if (!team || !registry) {
    return false;
  }

  const commandButtonDef = findCommandButtonDefByName(registry, commandButtonName);
  if (!commandButtonDef) {
    return false;
  }

  let processedCount = 0;
  let executed = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    processedCount += 1;
    if (executeScriptCommandButtonForEntity(self, entity, commandButtonDef, { kind: 'NONE' })) {
      executed = true;
    }
  }
  return executed || processedCount === 0;
}

export function executeScriptTeamUseCommandButtonAbilityOnNamed(self: GL, 
  teamName: string,
  commandButtonName: string,
  targetEntityId: number,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  const registry = self.iniDataRegistry;
  const targetEntity = self.spawnedEntities.get(targetEntityId);
  if (!team || !registry || !targetEntity || targetEntity.destroyed) {
    return false;
  }

  const commandButtonDef = findCommandButtonDefByName(registry, commandButtonName);
  if (!commandButtonDef) {
    return false;
  }

  let processedCount = 0;
  let executed = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    processedCount += 1;
    if (executeScriptCommandButtonForEntity(self, entity, commandButtonDef, {
      kind: 'OBJECT',
      targetEntity,
    })) {
      executed = true;
    }
  }
  return executed || processedCount === 0;
}

export function executeScriptTeamUseCommandButtonAbilityAtWaypoint(self: GL, 
  teamName: string,
  commandButtonName: string,
  waypointName: string,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  const registry = self.iniDataRegistry;
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  if (!team || !registry || !waypoint) {
    return false;
  }

  const commandButtonDef = findCommandButtonDefByName(registry, commandButtonName);
  if (!commandButtonDef) {
    return false;
  }

  let processedCount = 0;
  let executed = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    processedCount += 1;
    if (executeScriptCommandButtonForEntity(self, entity, commandButtonDef, {
      kind: 'POSITION',
      targetX: waypoint.x,
      targetZ: waypoint.z,
    })) {
      executed = true;
    }
  }
  return executed || processedCount === 0;
}

export function applyScriptEntityFlash(self: GL, entity: MapEntity, timeInSeconds: number, color: number): boolean {
  if (timeInSeconds <= 0) {
    return true;
  }
  const frames = Math.trunc(LOGIC_FRAME_RATE * timeInSeconds);
  const flashCount = Math.max(0, Math.trunc(frames / DRAWABLE_FRAMES_PER_FLASH));
  entity.scriptFlashColor = color;
  entity.scriptFlashCount = flashCount;
  return true;
}

export function resolveScriptEntityFlashColor(self: GL, entity: MapEntity): number {
  if (entity.customIndicatorColor !== null) {
    return entity.customIndicatorColor >>> 0;
  }
  // Source parity gap: use per-side indicator color when UI player colors are wired.
  return SOURCE_FLASH_COLOR_WHITE;
}

export function executeScriptNamedFlash(self: GL, entityId: number, timeInSeconds: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  return applyScriptEntityFlash(self, 
    entity,
    timeInSeconds,
    resolveScriptEntityFlashColor(self, entity),
  );
}

export function executeScriptTeamFlash(self: GL, teamName: string, timeInSeconds: number): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  let flashed = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    if (applyScriptEntityFlash(self, entity, timeInSeconds, resolveScriptEntityFlashColor(self, entity))) {
      flashed = true;
    }
  }
  return flashed;
}

export function executeScriptNamedFlashWhite(self: GL, entityId: number, timeInSeconds: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  return applyScriptEntityFlash(self, entity, timeInSeconds, SOURCE_FLASH_COLOR_WHITE);
}

export function executeScriptTeamFlashWhite(self: GL, teamName: string, timeInSeconds: number): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  let flashed = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    if (applyScriptEntityFlash(self, entity, timeInSeconds, SOURCE_FLASH_COLOR_WHITE)) {
      flashed = true;
    }
  }
  return flashed;
}

export function executeScriptNamedCustomColor(self: GL, entityId: number, color: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  if (!Number.isFinite(color)) {
    return false;
  }
  entity.customIndicatorColor = Math.trunc(color) >>> 0;
  return true;
}

export function executeScriptNamedReceiveUpgrade(self: GL, entityId: number, upgradeName: string): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }

  const normalizedUpgrade = upgradeName.trim().toUpperCase();
  if (!normalizedUpgrade || normalizedUpgrade === 'NONE') {
    return false;
  }

  const registry = self.iniDataRegistry;
  if (!registry || !findUpgradeDefByName(registry, normalizedUpgrade)) {
    return false;
  }

  if (self.applyUpgradeToEntity(entityId, normalizedUpgrade)) {
    return true;
  }
  return entity.completedUpgrades.has(normalizedUpgrade);
}

export function resolveScriptBuildPlacementAngle(self: GL, objectDef: ObjectDef): number {
  const placementAngleDegrees = readNumericField(objectDef.fields, ['PlacementViewAngle']) ?? 0;
  if (!Number.isFinite(placementAngleDegrees)) {
    return 0;
  }
  return placementAngleDegrees * (Math.PI / 180);
}

export function executeScriptAIPlayerBuildTypeNearestTeam(self: GL, 
  explicitPlayerSide: string,
  templateName: string,
  teamName: string,
): boolean {
  const side = resolveScriptCurrentPlayerSide(self, explicitPlayerSide);
  if (!side) {
    return false;
  }

  const normalizedTemplateName = templateName.trim().toUpperCase();
  if (!normalizedTemplateName) {
    return false;
  }

  const registry = self.iniDataRegistry;
  if (!registry) {
    return false;
  }
  const objectDef = findObjectDefByName(registry, normalizedTemplateName);
  if (!objectDef) {
    return false;
  }
  if (!self.canSideBuildUnitTemplate(side, objectDef)) {
    return false;
  }

  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const angle = resolveScriptBuildPlacementAngle(self, objectDef);
  const teamMembers = getScriptTeamMemberEntities(self, team)
    .filter((entity) => !entity.destroyed);
  const location = resolveScriptTeamCenter(self, teamMembers);
  if (!location) {
    return false;
  }

  return self.tryScriptConstructBuildingWithWiggleSearch(
    side,
    objectDef,
    location.x,
    location.z,
    angle,
  );
}

export function executeScriptAIPlayerBuildSupplyCenter(self: GL, 
  explicitPlayerSide: string,
  templateName: string,
  minimumCash: number,
): boolean {
  const side = resolveScriptCurrentPlayerSide(self, explicitPlayerSide);
  if (!side) {
    return false;
  }

  const normalizedTemplateName = templateName.trim().toUpperCase();
  if (!normalizedTemplateName) {
    return false;
  }

  const registry = self.iniDataRegistry;
  if (!registry) {
    return false;
  }
  const objectDef = findObjectDefByName(registry, normalizedTemplateName);
  if (!objectDef) {
    return false;
  }
  if (!self.canSideBuildUnitTemplate(side, objectDef)) {
    return false;
  }

  const isCashGenerator = self.normalizeKindOf(objectDef.kindOf).has('CASH_GENERATOR');
  let sourceWarehouse = findScriptSupplySourceForSide(self, side, Math.trunc(minimumCash));

  if (!isCashGenerator) {
    const currentWarehouseId = self.scriptCurrentSupplyWarehouseBySide.get(side);
    if (currentWarehouseId !== undefined) {
      const currentWarehouse = self.spawnedEntities.get(currentWarehouseId);
      if (currentWarehouse && !currentWarehouse.destroyed) {
        sourceWarehouse = currentWarehouse;
      }
    }
  }
  if (!sourceWarehouse) {
    return false;
  }

  const baseCenter = self.resolveAiBaseCenter(side);
  const enemyCenter = resolveScriptEnemyBaseCenter(self, side);
  let directionX = baseCenter ? sourceWarehouse.x - baseCenter.x : 0;
  let directionZ = baseCenter ? sourceWarehouse.z - baseCenter.z : 0;
  let radius = 3 * PATHFIND_CELL_SIZE;

  if (!isCashGenerator) {
    if (enemyCenter) {
      directionX = sourceWarehouse.x - enemyCenter.x;
      directionZ = sourceWarehouse.z - enemyCenter.z;
    }
    radius = self.resolveEntityMajorRadius(sourceWarehouse);
  }

  let targetX = sourceWarehouse.x;
  let targetZ = sourceWarehouse.z;
  const directionLength = Math.hypot(directionX, directionZ);
  if (directionLength > 0.00001) {
    directionX /= directionLength;
    directionZ /= directionLength;
    targetX -= directionX * radius;
    targetZ -= directionZ * radius;
  }

  const angle = resolveScriptBuildPlacementAngle(self, objectDef);
  const queued = self.tryScriptConstructBuildingWithWiggleSearch(side, objectDef, targetX, targetZ, angle);
  if (queued) {
    self.scriptCurrentSupplyWarehouseBySide.set(side, sourceWarehouse.id);
  }
  return queued;
}

export function executeScriptAIPlayerBuildUpgrade(self: GL, 
  explicitPlayerSide: string,
  upgradeName: string,
): boolean {
  const side = resolveScriptCurrentPlayerSide(self, explicitPlayerSide);
  if (!side) {
    return false;
  }

  const normalizedUpgradeInput = upgradeName.trim().toUpperCase();
  if (!normalizedUpgradeInput) {
    return false;
  }

  const registry = self.iniDataRegistry;
  if (!registry) {
    return false;
  }
  const upgradeDef = findUpgradeDefByName(registry, normalizedUpgradeInput);
  if (!upgradeDef) {
    return false;
  }
  if (resolveUpgradeType(upgradeDef) !== 'PLAYER') {
    return false;
  }

  const normalizedUpgradeName = upgradeDef.name.trim().toUpperCase();
  if (!normalizedUpgradeName || normalizedUpgradeName === 'NONE') {
    return false;
  }

  const eligibleFactories = Array.from(self.spawnedEntities.values())
    .filter((entity) =>
      !entity.destroyed
      && self.normalizeSide(entity.side) === side
      && !entity.objectStatusFlags.has('UNDER_CONSTRUCTION')
      && !entity.objectStatusFlags.has('SOLD')
      && entity.productionProfile !== null)
    .sort((left, right) => left.id - right.id);

  for (const factory of eligibleFactories) {
    if (self.queueUpgradeProduction(factory.id, normalizedUpgradeName)) {
      return true;
    }
  }

  return false;
}

export function executeScriptSkirmishBuildBuilding(self: GL, 
  templateName: string,
  explicitPlayerSide: string,
): boolean {
  const normalizedTemplateName = templateName.trim().toUpperCase();
  if (!normalizedTemplateName) {
    return false;
  }

  const side = resolveScriptCurrentPlayerSide(self, explicitPlayerSide);
  if (!side) {
    return false;
  }

  const registry = self.iniDataRegistry;
  if (!registry) {
    return false;
  }

  const objectDef = findObjectDefByName(registry, normalizedTemplateName);
  if (!objectDef) {
    return false;
  }
  if (!self.canSideBuildUnitTemplate(side, objectDef)) {
    return false;
  }

  const dozer = findScriptBuildDozerForTemplate(self, side, objectDef.name);
  if (!dozer) {
    return false;
  }

  const beforePending = self.pendingConstructionActions.get(dozer.id);
  self.handleConstructBuildingCommand({
    type: 'constructBuilding',
    entityId: dozer.id,
    templateName: objectDef.name,
    targetPosition: [
      dozer.x,
      self.resolveGroundHeight(dozer.x, dozer.z),
      dozer.z,
    ],
    angle: dozer.rotationY,
    lineEndPosition: null,
  });

  const afterPending = self.pendingConstructionActions.get(dozer.id);
  return afterPending !== undefined && afterPending !== beforePending;
}

export function executeScriptSkirmishBuildBaseDefenseStructureForSide(self: GL, 
  side: string,
  templateName: string,
  flank: boolean,
): boolean {
  const normalizedTemplateName = templateName.trim().toUpperCase();
  if (!normalizedTemplateName) {
    return false;
  }

  const registry = self.iniDataRegistry;
  if (!registry) {
    return false;
  }
  const objectDef = findObjectDefByName(registry, normalizedTemplateName);
  if (!objectDef) {
    return false;
  }
  if (!self.canSideBuildUnitTemplate(side, objectDef)) {
    return false;
  }

  const baseCenterAndRadius = self.resolveCachedSkirmishBaseCenterAndRadius(side);
  if (!baseCenterAndRadius) {
    // Source parity fallback: no usable base center, so fall back to generic build placement.
    return executeScriptSkirmishBuildBuilding(self, objectDef.name, side);
  }

  const defenseState = self.getOrCreateScriptSkirmishBaseDefenseState(side);
  const startPosition = resolveScriptSkirmishStartPositionOneBased(self, side);
  const normalizedPathLabel = flank
    ? `${(defenseState.curFlankBaseDefense & 1) !== 0 ? SCRIPT_SKIRMISH_PATH_FLANK_LABEL : SCRIPT_SKIRMISH_PATH_BACKDOOR_LABEL}${startPosition}`
    : `${SCRIPT_SKIRMISH_PATH_CENTER_LABEL}${startPosition}`;

  let goalX = baseCenterAndRadius.centerX;
  let goalZ = baseCenterAndRadius.centerZ;
  const route = resolveScriptWaypointRouteByNormalizedLabel(self, 
    normalizedPathLabel,
    baseCenterAndRadius.centerX,
    baseCenterAndRadius.centerZ,
  );
  if (route && route.length > 0) {
    goalX = route[0]!.x;
    goalZ = route[0]!.z;
  } else if (flank) {
    return false;
  } else {
    const enemySide = resolveScriptSkirmishEnemySide(self, side);
    const bounds = enemySide
      ? getScriptSideStructureBounds(self, enemySide)
      : { loX: 0, loZ: 0, hiX: 0, hiZ: 0 };
    goalX = bounds.loX + ((bounds.hiX - bounds.loX) * 0.5);
    goalZ = bounds.loZ + ((bounds.hiZ - bounds.loZ) * 0.5);
  }

  let offsetX = goalX - baseCenterAndRadius.centerX;
  let offsetZ = goalZ - baseCenterAndRadius.centerZ;
  const offsetLength = Math.hypot(offsetX, offsetZ);
  if (offsetLength > 0.00001) {
    offsetX /= offsetLength;
    offsetZ /= offsetLength;
  } else {
    offsetX = 0;
    offsetZ = 0;
  }

  const defenseDistance = baseCenterAndRadius.radius + self.resolveSkirmishBaseDefenseExtraDistance();
  offsetX *= defenseDistance;
  offsetZ *= defenseDistance;

  const structureRadius = self.resolveObjectDefBoundingCircleRadius2D(objectDef);
  const baseCircumference = 2 * Math.PI * defenseDistance;
  if (baseCircumference <= 0 || !Number.isFinite(baseCircumference)) {
    return false;
  }

  const angleOffset = 2 * Math.PI * ((structureRadius * 4) / baseCircumference);
  if (!Number.isFinite(angleOffset) || angleOffset <= 0) {
    return false;
  }

  const placeAngle = resolveScriptBuildPlacementAngle(self, objectDef);
  for (let attempt = 0; attempt < SCRIPT_SKIRMISH_BASE_DEFENSE_MAX_ATTEMPTS; attempt += 1) {
    let angle = 0;
    if (flank) {
      const selector = defenseState.curFlankBaseDefense >> 1;
      if ((defenseState.curFlankBaseDefense & 1) !== 0) {
        if ((selector & 1) !== 0) {
          defenseState.curLeftFlankRightDefenseAngle -= angleOffset;
          angle = defenseState.curLeftFlankRightDefenseAngle;
        } else {
          angle = defenseState.curLeftFlankLeftDefenseAngle;
          defenseState.curLeftFlankLeftDefenseAngle += angleOffset;
        }
      } else if ((selector & 1) !== 0) {
        defenseState.curRightFlankRightDefenseAngle -= angleOffset;
        angle = defenseState.curRightFlankRightDefenseAngle;
      } else {
        angle = defenseState.curRightFlankLeftDefenseAngle;
        defenseState.curRightFlankLeftDefenseAngle += angleOffset;
      }
    } else {
      const selector = defenseState.curFrontBaseDefense;
      if ((selector & 1) !== 0) {
        defenseState.curFrontRightDefenseAngle -= angleOffset;
        angle = defenseState.curFrontRightDefenseAngle;
      } else {
        angle = defenseState.curFrontLeftDefenseAngle;
        defenseState.curFrontLeftDefenseAngle += angleOffset;
      }
    }

    if (angle > SCRIPT_SKIRMISH_BASE_DEFENSE_MAX_ANGLE) {
      return false;
    }

    const sinAngle = Math.sin(angle);
    const cosAngle = Math.cos(angle);
    const buildX = baseCenterAndRadius.centerX + (offsetX * cosAngle - offsetZ * sinAngle);
    const buildZ = baseCenterAndRadius.centerZ + (offsetZ * cosAngle + offsetX * sinAngle);

    if (flank) {
      defenseState.curFlankBaseDefense += 1;
    } else {
      defenseState.curFrontBaseDefense += 1;
    }

    if (self.tryScriptConstructBuildingAtPosition(side, objectDef, buildX, buildZ, placeAngle)) {
      return true;
    }
  }

  return false;
}

export function resolveScriptSkirmishStartPositionOneBased(self: GL, side: string): number {
  const startPosition = self.getSkirmishPlayerStartPosition(side);
  if (startPosition === null || !Number.isFinite(startPosition) || startPosition <= 0) {
    // Source parity: Player::getMpStartIndex defaults to 0 (=> 1 when one-based).
    return 1;
  }
  return Math.trunc(startPosition);
}

export function executeScriptSkirmishBuildBaseDefenseFront(self: GL, explicitPlayerSide: string): boolean {
  const side = resolveScriptCurrentPlayerSide(self, explicitPlayerSide);
  if (!side) {
    return false;
  }

  const templateName = resolveScriptSkirmishDefenseTemplateName(self, side);
  if (!templateName) {
    return false;
  }

  return executeScriptSkirmishBuildBaseDefenseStructureForSide(self, side, templateName, false);
}

export function executeScriptSkirmishBuildBaseDefenseFlank(self: GL, explicitPlayerSide: string): boolean {
  const side = resolveScriptCurrentPlayerSide(self, explicitPlayerSide);
  if (!side) {
    return false;
  }

  const templateName = resolveScriptSkirmishDefenseTemplateName(self, side);
  if (!templateName) {
    return false;
  }

  return executeScriptSkirmishBuildBaseDefenseStructureForSide(self, side, templateName, true);
}

export function executeScriptSkirmishBuildStructureFront(self: GL, 
  templateName: string,
  explicitPlayerSide: string,
): boolean {
  const side = resolveScriptCurrentPlayerSide(self, explicitPlayerSide);
  if (!side) {
    return false;
  }

  return executeScriptSkirmishBuildBaseDefenseStructureForSide(self, side, templateName, false);
}

export function executeScriptSkirmishBuildStructureFlank(self: GL, 
  templateName: string,
  explicitPlayerSide: string,
): boolean {
  const side = resolveScriptCurrentPlayerSide(self, explicitPlayerSide);
  if (!side) {
    return false;
  }

  return executeScriptSkirmishBuildBaseDefenseStructureForSide(self, side, templateName, true);
}

export function executeScriptSkirmishAttackNearestGroupWithValue(self: GL, 
  teamName: string,
  comparison: number,
  value: number,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  // Source parity: C++ only performs the query for GREATER_EQUAL and GREATER comparisons.
  const GREATER_EQUAL = 3;
  const GREATER = 4;
  if (comparison !== GREATER_EQUAL && comparison !== GREATER) {
    return false;
  }

  const teamMembers = getScriptTeamMemberEntities(self, team)
    .filter((entity) => !entity.destroyed && entity.canMove);
  if (teamMembers.length === 0) {
    return false;
  }

  const center = resolveScriptAIGroupCenter(self, teamMembers);
  if (!center) {
    return false;
  }

  const source = teamMembers[0]!;
  const target = resolveScriptNearestEnemyGroupLocationWithValue(self, team, source, center, value);
  if (!target) {
    return false;
  }

  let movedAny = false;
  for (const entity of teamMembers) {
    self.applyCommand({
      type: 'attackMoveTo',
      entityId: entity.id,
      targetX: target.x,
      targetZ: target.z,
      attackDistance: self.resolveAttackMoveDistance(entity),
      commandSource: 'SCRIPT',
    });
    if (entity.moveTarget !== null || entity.attackTargetPosition !== null) {
      movedAny = true;
    }
  }
  return movedAny;
}

export function resolveScriptNearestEnemyGroupLocationWithValue(self: GL, 
  team: ScriptTeamRecord,
  sourceEntity: MapEntity,
  sourceLocation: VectorXZ,
  valueRequired: number,
): VectorXZ | null {
  if (!self.mapHeightmap) {
    return null;
  }

  const partitionCellSize = Number.isFinite(self.config.partitionCellSize) && self.config.partitionCellSize > 0
    ? self.config.partitionCellSize
    : PATHFIND_CELL_SIZE;
  const mapCellWidth = Math.max(1, Math.ceil(self.mapHeightmap.worldWidth / partitionCellSize));
  const mapCellHeight = Math.max(1, Math.ceil(self.mapHeightmap.worldDepth / partitionCellSize));
  const [startCellX, startCellZ] = self.worldToPartitionCell(
    sourceLocation.x,
    sourceLocation.z,
    partitionCellSize,
    mapCellWidth,
    mapCellHeight,
  );
  if (startCellX === null || startCellZ === null) {
    return null;
  }

  const sourceOffMap = self.isEntityOffMap(sourceEntity);
  const cellCashValue = new Map<number, number>();
  for (const candidate of self.spawnedEntities.values()) {
    if (candidate.destroyed) {
      continue;
    }
    if (self.isEntityOffMap(candidate) !== sourceOffMap) {
      continue;
    }
    const relation = getScriptTeamCandidateRelationship(self, team, sourceEntity, candidate);
    const sameControllingPlayer = isScriptTeamCandidateSameControllingPlayer(self, 
      team,
      sourceEntity,
      candidate,
    );
    if (relation !== RELATIONSHIP_ENEMIES && !sameControllingPlayer) {
      continue;
    }

    const [candidateCellX, candidateCellZ] = self.worldToPartitionCell(
      candidate.x,
      candidate.z,
      partitionCellSize,
      mapCellWidth,
      mapCellHeight,
    );
    if (candidateCellX === null || candidateCellZ === null) {
      continue;
    }

    const index = candidateCellZ * mapCellWidth + candidateCellX;
    const nextValue = (cellCashValue.get(index) ?? 0) + self.resolveEntityBuildCostRaw(candidate);
    cellCashValue.set(index, nextValue);
  }

  // Source parity quirk: PartitionManager.cpp currently assigns this flag from valueRequired.
  // For positive values (the skirmish script use-case), this resolves to strict ">" matching.
  const greaterThan = valueRequired !== 0;
  const visited = new Uint8Array(mapCellWidth * mapCellHeight);
  const queueX: number[] = [startCellX];
  const queueZ: number[] = [startCellZ];
  visited[startCellZ * mapCellWidth + startCellX] = 1;

  let head = 0;
  while (head < queueX.length) {
    const cellX = queueX[head]!;
    const cellZ = queueZ[head]!;
    head += 1;

    const index = cellZ * mapCellWidth + cellX;
    const valueAtCell = cellCashValue.get(index) ?? 0;
    if ((valueAtCell > valueRequired && greaterThan) || (valueAtCell < valueRequired && !greaterThan)) {
      return {
        x: cellX * partitionCellSize,
        z: cellZ * partitionCellSize,
      };
    }

    if (cellX - 1 >= 0) {
      const nextIndex = cellZ * mapCellWidth + (cellX - 1);
      if (visited[nextIndex] === 0) {
        visited[nextIndex] = 1;
        queueX.push(cellX - 1);
        queueZ.push(cellZ);
      }
    }
    if (cellZ - 1 >= 0) {
      const nextIndex = (cellZ - 1) * mapCellWidth + cellX;
      if (visited[nextIndex] === 0) {
        visited[nextIndex] = 1;
        queueX.push(cellX);
        queueZ.push(cellZ - 1);
      }
    }
    if (cellX + 1 < mapCellWidth) {
      const nextIndex = cellZ * mapCellWidth + (cellX + 1);
      if (visited[nextIndex] === 0) {
        visited[nextIndex] = 1;
        queueX.push(cellX + 1);
        queueZ.push(cellZ);
      }
    }
    if (cellZ + 1 < mapCellHeight) {
      const nextIndex = (cellZ + 1) * mapCellWidth + cellX;
      if (visited[nextIndex] === 0) {
        visited[nextIndex] = 1;
        queueX.push(cellX);
        queueZ.push(cellZ + 1);
      }
    }
  }

  return null;
}

export function executeScriptSkirmishCommandButtonOnMostValuableObject(self: GL, 
  teamName: string,
  abilityName: string,
  range: number,
  allTeamMembers: boolean,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const normalizedAbilityName = abilityName.trim();
  if (!normalizedAbilityName) {
    return false;
  }

  // Source parity: parameter is currently ignored by C++ implementation.
  void allTeamMembers;

  const searchRange = Number.isFinite(range) ? Math.max(0, range) : 0;
  const searchRangeSqr = searchRange * searchRange;
  const resolved = resolveScriptTeamCommandButtonSource(self, team, normalizedAbilityName);
  if (!resolved) {
    return false;
  }
  const { teamMembers, sourceEntity, commandButtonDef } = resolved;

  const center = resolveScriptAIGroupCenter(self, teamMembers);
  if (!center) {
    return false;
  }

  const sourceOffMap = self.isEntityOffMap(sourceEntity);
  const candidates: Array<{ entity: MapEntity; buildCost: number }> = [];
  for (const candidate of self.spawnedEntities.values()) {
    if (candidate.destroyed) {
      continue;
    }
    if (self.isEntityOffMap(candidate) !== sourceOffMap) {
      continue;
    }
    const relation = getScriptTeamCandidateRelationship(self, team, sourceEntity, candidate);
    const sameControllingPlayer = isScriptTeamCandidateSameControllingPlayer(self, 
      team,
      sourceEntity,
      candidate,
    );
    if (relation !== RELATIONSHIP_ENEMIES && !sameControllingPlayer) {
      continue;
    }

    const dx = candidate.x - center.x;
    const dz = candidate.z - center.z;
    const distSqr = (dx * dx) + (dz * dz);
    if (distSqr >= searchRangeSqr) {
      continue;
    }

    if (!executeScriptCommandButtonForEntity(self, sourceEntity, commandButtonDef, {
      kind: 'OBJECT',
      targetEntity: candidate,
    }, true)) {
      continue;
    }

    candidates.push({
      entity: candidate,
      buildCost: self.resolveEntityBuildCostRaw(candidate),
    });
  }

  candidates.sort((left, right) => right.buildCost - left.buildCost);

  const target = candidates[0]?.entity;
  if (!target) {
    return false;
  }

  return executeScriptTeamCommandButtonAtObjectForAllMembers(self, 
    team,
    commandButtonDef.name,
    target,
  );
}

export function appendScriptSequentialScript(self: GL, script: ScriptSequentialScriptState): void {
  const newScript: ScriptSequentialScriptState = {
    ...script,
    currentInstruction: -1,
    framesToWait: script.framesToWait ?? -1,
    dontAdvanceInstruction: false,
    nextScript: null,
  };

  const hasObject = newScript.objectId !== null && newScript.objectId !== 0;
  const hasTeam = !!newScript.teamNameUpper;
  for (const seqScript of self.scriptSequentialScripts) {
    if (hasObject && seqScript.objectId === newScript.objectId) {
      let tail = seqScript;
      while (tail.nextScript) {
        tail = tail.nextScript;
      }
      tail.nextScript = newScript;
      return;
    }
    if (!hasObject && hasTeam && seqScript.teamNameUpper === newScript.teamNameUpper) {
      let tail = seqScript;
      while (tail.nextScript) {
        tail = tail.nextScript;
      }
      tail.nextScript = newScript;
      return;
    }
  }

  self.scriptSequentialScripts.push(newScript);
}

export function setScriptSequentialTimerForEntity(self: GL, entityId: number, frameCount: number): void {
  for (const seqScript of self.scriptSequentialScripts) {
    if (seqScript.objectId === entityId) {
      seqScript.framesToWait = Math.trunc(frameCount);
      return;
    }
  }
}

export function setScriptSequentialTimerForTeam(self: GL, teamNameUpper: string, frameCount: number): void {
  for (const seqScript of self.scriptSequentialScripts) {
    if (seqScript.teamNameUpper === teamNameUpper) {
      seqScript.framesToWait = Math.trunc(frameCount);
      return;
    }
  }
}

export function executeScriptUnitExecuteSequentialScript(self: GL, 
  entityId: number,
  scriptName: string,
  timesToLoop: number,
): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  const normalizedScriptName = scriptName.trim().toUpperCase();
  if (!normalizedScriptName) {
    return false;
  }
  appendScriptSequentialScript(self, {
    scriptNameUpper: normalizedScriptName,
    objectId: entityId,
    teamNameUpper: null,
    currentInstruction: -1,
    timesToLoop: Math.trunc(timesToLoop),
    framesToWait: -1,
    dontAdvanceInstruction: false,
    nextScript: null,
  });
  return true;
}

export function executeScriptTeamExecuteSequentialScript(self: GL, 
  teamName: string,
  scriptName: string,
  timesToLoop: number,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }
  const normalizedScriptName = scriptName.trim().toUpperCase();
  if (!normalizedScriptName) {
    return false;
  }

  // Source parity: idle the team before executing the sequential script.
  executeScriptTeamStop(self, team.nameUpper);

  appendScriptSequentialScript(self, {
    scriptNameUpper: normalizedScriptName,
    objectId: null,
    teamNameUpper: team.nameUpper,
    currentInstruction: -1,
    timesToLoop: Math.trunc(timesToLoop),
    framesToWait: -1,
    dontAdvanceInstruction: false,
    nextScript: null,
  });
  return true;
}

export function executeScriptUnitStopSequentialScript(self: GL, entityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity) {
    return false;
  }
  self.removeAllSequentialScriptsForEntity(entityId);
  return true;
}

export function executeScriptTeamStopSequentialScript(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  self.removeAllSequentialScriptsForTeam(team.nameUpper);
  return true;
}

export function executeScriptUnitGuardForFramecount(self: GL, entityId: number, frameCount: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  self.applyCommand({
    type: 'guardPosition',
    entityId,
    targetX: entity.x,
    targetZ: entity.z,
    guardMode: 0,
    commandSource: 'SCRIPT',
  });
  setScriptSequentialTimerForEntity(self, entityId, frameCount);
  return true;
}

export function executeScriptUnitIdleForFramecount(self: GL, entityId: number, frameCount: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  self.applyCommand({ type: 'stop', entityId, commandSource: 'SCRIPT' });
  setScriptSequentialTimerForEntity(self, entityId, frameCount);
  return true;
}

export function executeScriptTeamIdleForFramecount(self: GL, teamName: string, frameCount: number): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    self.applyCommand({ type: 'stop', entityId: entity.id, commandSource: 'SCRIPT' });
  }
  setScriptSequentialTimerForTeam(self, team.nameUpper, frameCount);
  return true;
}

export function executeScriptWaterChangeHeight(self: GL, waterName: string, newHeight: number): boolean {
  const waterIndices = self.resolveWaterPolygonIndicesByName(waterName);
  if (waterIndices.length === 0) {
    return false;
  }
  for (const index of waterIndices) {
    // Source parity: ScriptActions::doWaterChangeHeight uses large damage amount to kill underwater objects.
    self.applyWaterHeightChange(index, newHeight, 999999.9, true);
  }
  return true;
}

export function executeScriptWaterChangeHeightOverTime(self: GL, 
  waterName: string,
  newHeight: number,
  timeSeconds: number,
  damageAmount: number,
): boolean {
  const waterIndices = self.resolveWaterPolygonIndicesByName(waterName);
  if (waterIndices.length === 0) {
    return false;
  }
  for (const waterIndex of waterIndices) {
    // Remove any existing update for this water table.
    for (let index = self.dynamicWaterUpdates.length - 1; index >= 0; index -= 1) {
      if (self.dynamicWaterUpdates[index]!.waterIndex === waterIndex) {
        self.dynamicWaterUpdates.splice(index, 1);
      }
    }
    if (self.dynamicWaterUpdates.length >= MAX_DYNAMIC_WATER) {
      return false;
    }
    const currentHeight = self.waterPolygonData[waterIndex]?.waterHeight ?? 0;
    const denom = LOGIC_FRAME_RATE * timeSeconds;
    const changePerFrame = denom !== 0
      ? (newHeight - currentHeight) / denom
      : (newHeight > currentHeight
        ? Number.POSITIVE_INFINITY
        : (newHeight < currentHeight ? Number.NEGATIVE_INFINITY : 0));
    self.dynamicWaterUpdates.push({
      waterIndex,
      targetHeight: newHeight,
      changePerFrame,
      damageAmount,
      currentHeight,
    });
  }
  return true;
}

export function executeScriptMapSwitchBorder(self: GL, borderIndex: number): boolean {
  // Source parity: ScriptActions::doBorderSwitch temporarily removes permanent
  // replay-observer reveal before boundary swap, then reapplies it.
  const observerSide = self.scriptPlayerSideByName.get('REPLAYOBSERVER') ?? '';
  const observerPlayerIndex = observerSide
    ? self.resolvePlayerIndexForSide(observerSide)
    : -1;
  if (observerPlayerIndex >= 0 && self.fogOfWarGrid) {
    self.fogOfWarGrid.undoRevealMapForPlayerPermanently(observerPlayerIndex);
  }

  self.scriptActiveBoundaryIndex = Math.trunc(borderIndex);
  if (self.scriptActiveBoundaryIndex < 0) {
    self.scriptActiveBoundaryIndex = 0;
  }

  if (observerPlayerIndex >= 0 && self.fogOfWarGrid) {
    self.fogOfWarGrid.revealMapForPlayerPermanently(observerPlayerIndex);
  }

  // Source parity: PartitionManager::refreshShroudForLocalPlayer.
  self.updateFogOfWar();
  return true;
}

export function executeScriptSkirmishWaitForCommandButtonAvailability(self: GL, 
  teamName: string,
  commandButtonName: string,
  allReady: boolean,
): boolean {
  return self.evaluateScriptTeamCommandButtonReadinessByName(teamName, commandButtonName, allReady);
}

export function executeScriptTeamWaitForNotContained(self: GL, teamName: string, allContained: boolean): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }
  return !self.evaluateScriptTeamIsContained({
    teamName: team.nameUpper,
    allContained,
  });
}

export function executeScriptTeamSpinForFramecount(self: GL, teamName: string, waitForFrames: number): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }
  const waitFrames = Math.max(0, Math.trunc(waitForFrames));
  setScriptSequentialTimerForTeam(self, team.nameUpper, waitFrames);
  return true;
}

export function resolveScriptTeamCommandButtonSource(self: GL, 
  team: ScriptTeamRecord,
  commandButtonName: string,
  excludedEntityIds: Set<number> | null = null,
): {
  teamMembers: MapEntity[];
  sourceEntity: MapEntity;
  commandButtonDef: CommandButtonDef;
} | null {
  const registry = self.iniDataRegistry;
  if (!registry) {
    return null;
  }

  const commandButtonDef = findCommandButtonDefByName(registry, commandButtonName);
  if (!commandButtonDef) {
    return null;
  }

  const teamMembers = getScriptTeamMemberEntities(self, team)
    .filter((entity) => !entity.destroyed && (excludedEntityIds ? !excludedEntityIds.has(entity.id) : true));
  if (teamMembers.length === 0) {
    return null;
  }

  for (const member of teamMembers) {
    const memberButtons = findScriptEntityCommandButtonsByName(self, member, commandButtonDef.name);
    if (memberButtons.length > 0) {
      return {
        teamMembers,
        sourceEntity: member,
        commandButtonDef,
      };
    }
  }

  return null;
}

export function getScriptTeamCandidateRelationship(self: GL, 
  team: ScriptTeamRecord,
  sourceEntity: MapEntity,
  candidate: MapEntity,
): number {
  const teamSide = resolveScriptTeamControllingSide(self, team);
  const candidateSide = self.normalizeSide(candidate.side ?? '');
  if (teamSide && candidateSide) {
    return self.getTeamRelationshipBySides(teamSide, candidateSide);
  }
  return self.getTeamRelationship(sourceEntity, candidate);
}

export function resolveScriptTeamControllingPlayerTokenForAffiliation(self: GL, 
  team: ScriptTeamRecord,
  sourceEntity: MapEntity,
): string | null {
  return (
    self.normalizeControllingPlayerToken(team.controllingPlayerToken ?? undefined)
    ?? self.normalizeControllingPlayerToken(team.controllingSide ?? undefined)
    ?? self.resolveEntityControllingPlayerTokenForAffiliation(sourceEntity)
  );
}

export function isScriptTeamCandidateSameControllingPlayer(self: GL, 
  team: ScriptTeamRecord,
  sourceEntity: MapEntity,
  candidate: MapEntity,
): boolean {
  const teamOwnerToken = resolveScriptTeamControllingPlayerTokenForAffiliation(self, team, sourceEntity);
  if (!teamOwnerToken) {
    return false;
  }
  const candidateOwnerToken = self.resolveEntityControllingPlayerTokenForAffiliation(candidate);
  return candidateOwnerToken !== null && candidateOwnerToken === teamOwnerToken;
}

export function executeScriptTeamCommandButtonOnNearestObjectAcrossTeams(self: GL, 
  teamName: string,
  commandButtonName: string,
  filter: {
    allowEnemies: boolean;
    allowNeutral: boolean;
    requireStructure: boolean;
    requireGarrisonable: boolean;
    requiredKindOf: string | null;
    requiredTemplateName: string | null;
    requiredTemplateNames?: string[] | null;
  },
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }
  return executeScriptTeamCommandButtonOnNearestObject(self, team, commandButtonName, filter);
}

export function executeScriptTeamAllUseCommandButtonOnNamed(self: GL, 
  teamName: string,
  commandButtonName: string,
  targetEntityId: unknown,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  const resolvedTargetId = resolveScriptEntityId(self, targetEntityId);
  const targetEntity = resolvedTargetId !== null ? self.spawnedEntities.get(resolvedTargetId) : null;
  if (!team || !targetEntity || targetEntity.destroyed) {
    return false;
  }

  const resolved = resolveScriptTeamCommandButtonSource(self, team, commandButtonName);
  if (!resolved) {
    return false;
  }
  if (!executeScriptCommandButtonForEntity(self, 
    resolved.sourceEntity,
    resolved.commandButtonDef,
    { kind: 'OBJECT', targetEntity },
    true,
  )) {
    return false;
  }
  return executeScriptTeamCommandButtonAtObjectForAllMembers(self, 
    team,
    resolved.commandButtonDef.name,
    targetEntity,
  );
}

export function executeScriptTeamAllUseCommandButtonOnNearestEnemyUnit(self: GL, 
  teamName: string,
  commandButtonName: string,
): boolean {
  return executeScriptTeamCommandButtonOnNearestObjectAcrossTeams(self, teamName, commandButtonName, {
    allowEnemies: true,
    allowNeutral: false,
    requireStructure: false,
    requireGarrisonable: false,
    requiredKindOf: null,
    requiredTemplateName: null,
  });
}

export function executeScriptTeamAllUseCommandButtonOnNearestGarrisonedBuilding(self: GL, 
  teamName: string,
  commandButtonName: string,
): boolean {
  return executeScriptTeamCommandButtonOnNearestObjectAcrossTeams(self, teamName, commandButtonName, {
    allowEnemies: true,
    allowNeutral: false,
    requireStructure: true,
    requireGarrisonable: true,
    requiredKindOf: null,
    requiredTemplateName: null,
  });
}

export function executeScriptTeamAllUseCommandButtonOnNearestKindOf(self: GL, 
  teamName: string,
  commandButtonName: string,
  kindOfInput: unknown,
): boolean {
  const kindOfName = resolveScriptKindOfNameFromInput(self, kindOfInput);
  if (!kindOfName) {
    return false;
  }
  return executeScriptTeamCommandButtonOnNearestObjectAcrossTeams(self, teamName, commandButtonName, {
    allowEnemies: true,
    allowNeutral: false,
    requireStructure: false,
    requireGarrisonable: false,
    requiredKindOf: kindOfName,
    requiredTemplateName: null,
  });
}

export function executeScriptTeamAllUseCommandButtonOnNearestEnemyBuilding(self: GL, 
  teamName: string,
  commandButtonName: string,
): boolean {
  return executeScriptTeamCommandButtonOnNearestObjectAcrossTeams(self, teamName, commandButtonName, {
    allowEnemies: true,
    allowNeutral: false,
    requireStructure: true,
    requireGarrisonable: false,
    requiredKindOf: null,
    requiredTemplateName: null,
  });
}

export function executeScriptTeamAllUseCommandButtonOnNearestEnemyBuildingClass(self: GL, 
  teamName: string,
  commandButtonName: string,
  kindOfInput: unknown,
): boolean {
  const kindOfName = resolveScriptKindOfNameFromInput(self, kindOfInput);
  if (!kindOfName) {
    return false;
  }
  return executeScriptTeamCommandButtonOnNearestObjectAcrossTeams(self, teamName, commandButtonName, {
    allowEnemies: true,
    allowNeutral: false,
    requireStructure: true,
    requireGarrisonable: false,
    requiredKindOf: kindOfName,
    requiredTemplateName: null,
  });
}

export function executeScriptTeamAllUseCommandButtonOnNearestObjectType(self: GL, 
  teamName: string,
  commandButtonName: string,
  templateName: string,
): boolean {
  const objectTypes = resolveScriptObjectTypeCandidatesForAction(self, templateName);
  if (!objectTypes || objectTypes.length === 0) {
    return false;
  }
  return executeScriptTeamCommandButtonOnNearestObjectAcrossTeams(self, teamName, commandButtonName, {
    allowEnemies: true,
    allowNeutral: true,
    requireStructure: false,
    requireGarrisonable: false,
    requiredKindOf: null,
    requiredTemplateName: null,
    requiredTemplateNames: objectTypes,
  });
}

export function executeScriptTeamPartialUseCommandButton(self: GL, 
  percentage: number,
  teamName: string,
  commandButtonName: string,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  const registry = self.iniDataRegistry;
  if (!team || !registry) {
    return false;
  }
  const commandButtonDef = findCommandButtonDefByName(registry, commandButtonName);
  if (!commandButtonDef) {
    return false;
  }

  const teamMembers = getScriptTeamMemberEntities(self, team)
    .filter((entity) => !entity.destroyed);
  if (teamMembers.length === 0) {
    return true;
  }

  const candidates: MapEntity[] = [];
  for (const entity of teamMembers) {
    if (!executeScriptCommandButtonForEntity(self, entity, commandButtonDef, { kind: 'NONE' }, true)) {
      continue;
    }
    candidates.push(entity);
  }

  const percentageValue = Number.isFinite(percentage) ? percentage : 0;
  const toExecuteCount = Math.max(0, Math.trunc((percentageValue / 100) * candidates.length));
  if (toExecuteCount <= 0) {
    return true;
  }

  let executedAny = false;
  for (let index = 0; index < candidates.length && index < toExecuteCount; index += 1) {
    const candidate = candidates[index]!;
    if (executeScriptCommandButtonForEntity(self, candidate, commandButtonDef, { kind: 'NONE' })) {
      executedAny = true;
    }
  }
  return executedAny || candidates.length === 0;
}

export function executeScriptTeamCaptureNearestUnownedFactionUnit(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const allTeamMembers = getScriptTeamMemberEntities(self, team)
    .filter((entity) => !entity.destroyed);
  if (allTeamMembers.length === 0) {
    return false;
  }
  const controllingSourceEntity = allTeamMembers[0]!;

  const center = resolveScriptAIGroupCenter(self, allTeamMembers);
  if (!center) {
    return false;
  }
  let closestTarget: MapEntity | null = null;
  let closestDistSqr = Number.POSITIVE_INFINITY;
  for (const candidate of self.spawnedEntities.values()) {
    if (candidate.destroyed) {
      continue;
    }
    if (self.isEntityOffMap(candidate)) {
      continue;
    }
    if (!self.entityHasObjectStatus(candidate, 'DISABLED_UNMANNED')) {
      continue;
    }

    // Source parity: PartitionFilterPlayerAffiliation(ALLOW_ENEMIES | ALLOW_NEUTRAL)
    // also admits objects controlled by the same player via its explicit self-player check.
    const sameControllingPlayer = isScriptTeamCandidateSameControllingPlayer(self, 
      team,
      controllingSourceEntity,
      candidate,
    );
    const relation = getScriptTeamCandidateRelationship(self, team, controllingSourceEntity, candidate);
    if (!sameControllingPlayer) {
      if (relation !== RELATIONSHIP_ENEMIES && relation !== RELATIONSHIP_NEUTRAL) {
        continue;
      }
    }

    const dx = candidate.x - center.x;
    const dz = candidate.z - center.z;
    const distSqr = (dx * dx) + (dz * dz);
    if (distSqr < closestDistSqr || (distSqr === closestDistSqr && (closestTarget === null || candidate.id < closestTarget.id))) {
      closestTarget = candidate;
      closestDistSqr = distSqr;
    }
  }
  if (!closestTarget) {
    return false;
  }

  let issuedAny = false;
  for (const entity of allTeamMembers) {
    // Source parity: ScriptActions::doTeamCaptureNearestUnownedFactionUnit calls
    // AIGroup::groupEnter on the full group membership; per-unit enter validation
    // remains in enter-action handling.
    if (self.canQueueEnterObjectAction(entity, closestTarget, 'captureUnmannedFactionUnit', 'SCRIPT')) {
      issuedAny = true;
    }
    self.applyCommand({
      type: 'enterObject',
      entityId: entity.id,
      targetObjectId: closestTarget.id,
      commandSource: 'SCRIPT',
      action: 'captureUnmannedFactionUnit',
    });
  }
  return issuedAny;
}

export function executeScriptPlayerCreateTeamFromCapturedUnits(self: GL, 
  playerName: string,
  teamName: string,
): boolean {
  // Source parity: player parameter is currently unused by C++.
  void playerName;
  return getScriptTeamRecord(self, teamName) !== null;
}

export function executeScriptTeamCommandButtonOnNearestObject(self: GL, 
  team: ScriptTeamRecord,
  commandButtonName: string,
  filter: {
    allowEnemies: boolean;
    allowNeutral: boolean;
    requireStructure: boolean;
    requireGarrisonable: boolean;
    requiredKindOf: string | null;
    requiredTemplateName: string | null;
    requiredTemplateNames?: string[] | null;
  },
  handledEntityIds: Set<number> | null = null,
): boolean {
  const resolved = resolveScriptTeamCommandButtonSource(self, team, commandButtonName, handledEntityIds);
  if (!resolved) {
    return false;
  }
  const { teamMembers, sourceEntity, commandButtonDef } = resolved;

  const center = resolveScriptAIGroupCenter(self, teamMembers);
  if (!center) {
    return false;
  }

  const sourceOffMap = self.isEntityOffMap(sourceEntity);
  const candidates: MapEntity[] = [];
  const normalizedTemplateName = filter.requiredTemplateName
    ? normalizeScriptObjectTypeName(self, filter.requiredTemplateName)
    : null;
  const requiredTemplateNames = filter.requiredTemplateNames
    ? Array.from(new Set(filter.requiredTemplateNames
      .map((name) => normalizeScriptObjectTypeName(self, name))
      .filter(Boolean)))
    : null;
  const requiredKindOf = filter.requiredKindOf?.trim().toUpperCase() ?? null;
  if (requiredTemplateNames && requiredTemplateNames.length === 0) {
    return false;
  }
  for (const candidate of self.spawnedEntities.values()) {
    if (candidate.destroyed) {
      continue;
    }
    if (self.isEntityOffMap(candidate) !== sourceOffMap) {
      continue;
    }

    const relation = getScriptTeamCandidateRelationship(self, team, sourceEntity, candidate);
    const sameControllingPlayer = isScriptTeamCandidateSameControllingPlayer(self, 
      team,
      sourceEntity,
      candidate,
    );
    const relationAllowed = sameControllingPlayer
      || (filter.allowEnemies && relation === RELATIONSHIP_ENEMIES)
      || (filter.allowNeutral && relation === RELATIONSHIP_NEUTRAL);
    if (!relationAllowed) {
      continue;
    }

    if (filter.requireStructure && !candidate.kindOf.has('STRUCTURE')) {
      continue;
    }
    if (filter.requireGarrisonable) {
      if (candidate.containProfile?.moduleType !== 'GARRISON' || candidate.containProfile.garrisonCapacity <= 0) {
        continue;
      }
    }
    if (requiredKindOf && !candidate.kindOf.has(requiredKindOf)) {
      continue;
    }
    if (requiredTemplateNames && requiredTemplateNames.length > 0) {
      if (!self.matchesScriptObjectTypeList(candidate.templateName, requiredTemplateNames)) {
        continue;
      }
    } else if (normalizedTemplateName
      && !self.areEquivalentTemplateNames(candidate.templateName, normalizedTemplateName)) {
      continue;
    }

    if (!executeScriptCommandButtonForEntity(self, sourceEntity, commandButtonDef, {
      kind: 'OBJECT',
      targetEntity: candidate,
    }, true)) {
      continue;
    }

    candidates.push(candidate);
  }

  candidates.sort((left, right) => {
    const leftDx = left.x - center.x;
    const leftDz = left.z - center.z;
    const rightDx = right.x - center.x;
    const rightDz = right.z - center.z;
    const leftDistSqr = (leftDx * leftDx) + (leftDz * leftDz);
    const rightDistSqr = (rightDx * rightDx) + (rightDz * rightDz);
    if (leftDistSqr !== rightDistSqr) {
      return leftDistSqr - rightDistSqr;
    }
    return left.id - right.id;
  });

  for (const candidate of candidates) {
    if (executeScriptTeamCommandButtonAtObjectForAllMembers(self, 
      team,
      commandButtonDef.name,
      candidate,
      handledEntityIds,
    )) {
      return true;
    }
  }
  return false;
}

export function executeScriptTeamCommandButtonAtObjectForAllMembers(self: GL, 
  team: ScriptTeamRecord,
  commandButtonName: string,
  targetEntity: MapEntity,
  handledEntityIds: Set<number> | null = null,
): boolean {
  const registry = self.iniDataRegistry;
  if (!registry) {
    return false;
  }
  const commandButtonDef = findCommandButtonDefByName(registry, commandButtonName);
  if (!commandButtonDef) {
    return false;
  }

  const teamMembers = getScriptTeamMemberEntities(self, team)
    .filter((entity) => !entity.destroyed && (handledEntityIds ? !handledEntityIds.has(entity.id) : true));
  if (teamMembers.length === 0) {
    return handledEntityIds === null;
  }

  let executedAny = false;
  for (const entity of teamMembers) {
    handledEntityIds?.add(entity.id);
    if (executeScriptCommandButtonForEntity(self, entity, commandButtonDef, {
      kind: 'OBJECT',
      targetEntity,
    })) {
      executedAny = true;
    }
  }
  return executedAny;
}

export function resolveScriptKindOfNameFromInput(self: GL, kindOfInput: unknown): string | null {
  if (typeof kindOfInput === 'number' && Number.isFinite(kindOfInput)) {
    return resolveScriptKindOfNameFromSourceBit(self, kindOfInput);
  }
  const token = coerceScriptConditionString(self, kindOfInput).trim().toUpperCase();
  if (!token) {
    return null;
  }
  if (token.startsWith('KINDOF_')) {
    return token.slice('KINDOF_'.length);
  }
  return token;
}

export function resolveScriptNamedSpecialPowerSource(self: GL, 
  entityId: number,
  specialPowerName: string,
): {
  sourceEntity: MapEntity;
  specialPowerToken: string;
  normalizedSpecialPowerName: string;
  isSharedSynced: boolean;
} | null {
  const sourceEntity = self.spawnedEntities.get(entityId);
  if (!sourceEntity || sourceEntity.destroyed) {
    return null;
  }

  const specialPowerToken = specialPowerName.trim();
  const normalizedSpecialPowerName = specialPowerToken.toUpperCase();
  if (!normalizedSpecialPowerName || normalizedSpecialPowerName === 'NONE') {
    return null;
  }

  const specialPowerDef = self.resolveSpecialPowerDefByName(normalizedSpecialPowerName);
  if (!specialPowerDef) {
    return null;
  }
  if (!sourceEntity.specialPowerModules.has(normalizedSpecialPowerName)) {
    return null;
  }

  return {
    sourceEntity,
    specialPowerToken,
    normalizedSpecialPowerName,
    isSharedSynced: readBooleanField(specialPowerDef.fields, ['SharedSyncedTimer']) === true,
  };
}

export function executeScriptNamedStopSpecialPowerCountdown(self: GL, 
  entityId: number,
  specialPowerName: string,
  stop: boolean,
): boolean {
  const resolved = resolveScriptNamedSpecialPowerSource(self, entityId, specialPowerName);
  if (!resolved) {
    return false;
  }

  // Source parity: SharedNSync ready frame lookup bypasses module pause state.
  if (resolved.isSharedSynced) {
    return true;
  }

  if (stop) {
    self.pauseNonSharedSpecialPowerCountdown(resolved.normalizedSpecialPowerName, resolved.sourceEntity.id, true);
    return true;
  }

  self.unpauseNonSharedSpecialPowerCountdown(resolved.normalizedSpecialPowerName, resolved.sourceEntity.id);
  return true;
}

export function executeScriptNamedSetSpecialPowerCountdown(self: GL, 
  entityId: number,
  specialPowerName: string,
  seconds: number,
): boolean {
  const resolved = resolveScriptNamedSpecialPowerSource(self, entityId, specialPowerName);
  if (!resolved) {
    return false;
  }

  const frames = LOGIC_FRAME_RATE * Math.trunc(seconds);
  self.setSpecialPowerReadyFrame(
    resolved.normalizedSpecialPowerName,
    resolved.sourceEntity.id,
    resolved.isSharedSynced,
    self.frameCounter + frames,
  );
  return true;
}

export function executeScriptNamedAddSpecialPowerCountdown(self: GL, 
  entityId: number,
  specialPowerName: string,
  seconds: number,
): boolean {
  const resolved = resolveScriptNamedSpecialPowerSource(self, entityId, specialPowerName);
  if (!resolved) {
    return false;
  }

  const frames = LOGIC_FRAME_RATE * Math.trunc(seconds);
  if (resolved.isSharedSynced) {
    const currentReadyFrame = resolveSharedShortcutSpecialPowerReadyFrameImpl(
      resolved.normalizedSpecialPowerName,
      self.frameCounter,
      self.sharedShortcutSpecialPowerReadyFrames,
      self.normalizeShortcutSpecialPowerName.bind(this),
    );
    self.setSpecialPowerReadyFrame(
      resolved.normalizedSpecialPowerName,
      resolved.sourceEntity.id,
      true,
      currentReadyFrame + frames,
    );
    return true;
  }

  const currentReadyFrame = self.resolveSpecialPowerReadyFrameForSourceEntity(
    resolved.normalizedSpecialPowerName,
    resolved.sourceEntity.id,
  );
  self.setSpecialPowerReadyFrame(
    resolved.normalizedSpecialPowerName,
    resolved.sourceEntity.id,
    false,
    currentReadyFrame + frames,
  );
  return true;
}

export function executeScriptNamedFireSpecialPowerAtWaypoint(self: GL, 
  entityId: number,
  specialPowerName: string,
  waypointName: string,
): boolean {
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  const resolved = resolveScriptNamedSpecialPowerSource(self, entityId, specialPowerName);
  if (!resolved || !waypoint) {
    return false;
  }

  self.applyCommand({
    type: 'issueSpecialPower',
    commandSource: 'SCRIPT',
    commandButtonId: '',
    specialPowerName: resolved.specialPowerToken,
    commandOption: SCRIPT_COMMAND_OPTION_NEED_TARGET_POS,
    issuingEntityIds: [resolved.sourceEntity.id],
    sourceEntityId: resolved.sourceEntity.id,
    targetEntityId: null,
    targetX: waypoint.x,
    targetZ: waypoint.z,
  });
  return true;
}

export function executeScriptNamedFireSpecialPowerAtNamed(self: GL, 
  entityId: number,
  specialPowerName: string,
  targetEntityId: number,
): boolean {
  const resolved = resolveScriptNamedSpecialPowerSource(self, entityId, specialPowerName);
  const targetEntity = self.spawnedEntities.get(targetEntityId);
  if (!resolved || !targetEntity || targetEntity.destroyed) {
    return false;
  }

  self.applyCommand({
    type: 'issueSpecialPower',
    commandSource: 'SCRIPT',
    commandButtonId: '',
    specialPowerName: resolved.specialPowerToken,
    commandOption: SCRIPT_COMMAND_OPTION_NEED_OBJECT_TARGET,
    issuingEntityIds: [resolved.sourceEntity.id],
    sourceEntityId: resolved.sourceEntity.id,
    targetEntityId: targetEntity.id,
    targetX: null,
    targetZ: null,
  });
  return true;
}

export function executeScriptSkirmishFireSpecialPowerAtMostCost(self: GL, 
  explicitPlayerSide: string,
  specialPowerName: string,
): boolean {
  const side = resolveScriptCurrentPlayerSide(self, explicitPlayerSide);
  if (!side) {
    return false;
  }

  const specialPowerToken = specialPowerName.trim();
  const normalizedSpecialPowerName = specialPowerToken.toUpperCase();
  if (!normalizedSpecialPowerName || normalizedSpecialPowerName === 'NONE') {
    return false;
  }

  const specialPowerDef = self.resolveSpecialPowerDefByName(normalizedSpecialPowerName);
  if (!specialPowerDef) {
    return false;
  }

  const enemySide = resolveScriptSkirmishEnemySide(self, side);
  if (!enemySide) {
    return false;
  }

  let weaponRadius = 50;
  const radiusCursorRadius = readNumericField(specialPowerDef.fields, ['RadiusCursorRadius']) ?? 0;
  if (radiusCursorRadius > weaponRadius) {
    weaponRadius = radiusCursorRadius;
  }

  const target = computeScriptSuperweaponTarget(self, enemySide, weaponRadius);

  let sourceEntity: MapEntity | null = null;
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (self.normalizeSide(entity.side) !== side) {
      continue;
    }
    if (!entity.specialPowerModules.has(normalizedSpecialPowerName)) {
      continue;
    }
    sourceEntity = entity;
    break;
  }
  if (!sourceEntity) {
    return false;
  }

  self.applyCommand({
    type: 'issueSpecialPower',
    commandSource: 'SCRIPT',
    commandButtonId: '',
    specialPowerName: specialPowerToken,
    commandOption: 0x20, // NEED_TARGET_POS
    issuingEntityIds: [sourceEntity.id],
    sourceEntityId: sourceEntity.id,
    targetEntityId: null,
    targetX: target.x,
    targetZ: target.z,
  });
  return true;
}

export function computeScriptSuperweaponTarget(self: GL, 
  targetSide: string,
  weaponRadius: number,
): { x: number; z: number } {
  const bounds = getScriptSideStructureBounds(self, targetSide);
  let radius = weaponRadius;
  if (!Number.isFinite(radius) || radius < 1) {
    radius = 1;
  }

  let loX = bounds.loX + radius;
  let hiX = bounds.hiX - radius;
  if (hiX < loX) {
    const middle = (hiX + loX) / 2;
    loX = middle;
    hiX = middle;
  }

  let loZ = bounds.loZ + radius;
  let hiZ = bounds.hiZ - radius;
  if (hiZ < loZ) {
    const middle = (hiZ + loZ) / 2;
    loZ = middle;
    hiZ = middle;
  }

  const width = hiX - loX;
  const height = hiZ - loZ;
  let xCount = Math.ceil(width / radius) + 1;
  let zCount = Math.ceil(height / radius) + 1;
  if (xCount > 10) xCount = 10;
  if (zCount > 10) zCount = 10;

  let bestValue = -1;
  let bestX = loX;
  let bestZ = loZ;
  for (let i = 0; i < xCount; i += 1) {
    for (let j = 0; j < zCount; j += 1) {
      const x = loX + (width * i) / xCount;
      const z = loZ + (height * j) / zCount;
      const currentValue = getScriptSuperweaponTargetValue(self, x, z, targetSide, 2 * radius);
      if (currentValue > bestValue) {
        bestValue = currentValue;
        bestX = x;
        bestZ = z;
      }
    }
  }

  let finalBestValue = -1;
  let finalBestX = 0;
  let finalBestZ = 0;
  let tieCount = 0;
  for (let i = 0; i < 11; i += 1) {
    for (let j = 0; j < 11; j += 1) {
      const x = bestX + (i - 5) * (radius / 10);
      const z = bestZ + (j - 5) * (radius / 10);
      const currentValue = getScriptSuperweaponTargetValue(self, x, z, targetSide, radius);
      if (currentValue > finalBestValue) {
        finalBestValue = currentValue;
        finalBestX = x;
        finalBestZ = z;
        tieCount = 1;
      } else if (currentValue === finalBestValue) {
        finalBestX += x;
        finalBestZ += z;
        tieCount += 1;
      }
    }
  }

  if (tieCount > 1) {
    finalBestX /= tieCount;
    finalBestZ /= tieCount;
  }

  return { x: finalBestX, z: finalBestZ };
}

export function getScriptSideStructureBounds(self: GL, targetSide: string): { loX: number; loZ: number; hiX: number; hiZ: number } {
  const normalizedTargetSide = self.normalizeSide(targetSide);
  if (!normalizedTargetSide) {
    return { loX: 0, loZ: 0, hiX: 0, hiZ: 0 };
  }

  let hasStructure = false;
  let loX = 0;
  let loZ = 0;
  let hiX = 0;
  let hiZ = 0;
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (self.normalizeSide(entity.side) !== normalizedTargetSide) {
      continue;
    }
    if (!entity.kindOf.has('STRUCTURE')) {
      continue;
    }

    if (!hasStructure) {
      loX = hiX = entity.x;
      loZ = hiZ = entity.z;
      hasStructure = true;
    } else {
      if (entity.x < loX) loX = entity.x;
      if (entity.z < loZ) loZ = entity.z;
      if (entity.x > hiX) hiX = entity.x;
      if (entity.z > hiZ) hiZ = entity.z;
    }
  }

  if (!hasStructure) {
    return { loX: 0, loZ: 0, hiX: 0, hiZ: 0 };
  }

  return { loX, loZ, hiX, hiZ };
}

export function getScriptSuperweaponTargetValue(self: GL, 
  centerX: number,
  centerZ: number,
  targetSide: string,
  radius: number,
): number {
  const minimumRadius = 4 * PATHFIND_CELL_SIZE;
  const effectiveRadius = radius < minimumRadius ? minimumRadius : radius;
  const radiusSqr = effectiveRadius * effectiveRadius;
  const normalizedTargetSide = self.normalizeSide(targetSide);
  if (!normalizedTargetSide) {
    return 0;
  }

  let valueTotal = 0;
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (self.normalizeSide(entity.side) !== normalizedTargetSide) {
      continue;
    }
    if (entity.kindOf.has('AIRCRAFT')) {
      const terrainY = self.resolveGroundHeight(entity.x, entity.z);
      if ((entity.y - entity.baseHeight - terrainY) > SIGNIFICANTLY_ABOVE_TERRAIN_THRESHOLD) {
        continue;
      }
    }

    const dx = centerX - entity.x;
    const dz = centerZ - entity.z;
    const distanceSqr = dx * dx + dz * dz;
    if (distanceSqr >= radiusSqr) {
      continue;
    }

    const objectDef = self.resolveObjectDefByTemplateName(entity.templateName);
    if (!objectDef) {
      continue;
    }
    const distance = Math.sqrt(distanceSqr);
    const distanceFactor = 1 - (distance / (2 * effectiveRadius)); // 1.0 at center, 0.5 at radius edge.
    let buildCost = self.resolveObjectBuildCost(objectDef, entity.side ?? '');
    if (entity.kindOf.has('COMMANDCENTER')) {
      buildCost /= 10;
    }
    if (buildCost > 3000) {
      buildCost /= 10;
    }
    valueTotal += distanceFactor * buildCost;
  }

  return valueTotal;
}

export function executeScriptPlayerRepairNamedStructure(self: GL, playerSide: string, targetBuildingId: number): boolean {
  const normalizedSide = self.normalizeSide(playerSide);
  if (!normalizedSide) {
    return false;
  }

  const building = self.spawnedEntities.get(targetBuildingId);
  if (!building || building.destroyed) {
    return false;
  }

  // Source parity: Player::repairStructure only delegates when the player has an AI controller.
  if (self.getSidePlayerType(normalizedSide) !== 'COMPUTER') {
    return true;
  }

  return self.queueScriptSideRepairRequest(normalizedSide, building.id);
}

export function resolveScriptCurrentPlayerSide(self: GL, explicitPlayerSide: string): string | null {
  const resolvedExplicit = resolveScriptPlayerSideFromInput(self, explicitPlayerSide);
  if (resolvedExplicit) {
    return resolvedExplicit;
  }
  return resolveScriptCurrentPlayerSideFromContext(self);
}

export function executeScriptNamedFireWeaponFollowingWaypointPath(self: GL, 
  entityId: number,
  waypointPathLabel: string,
): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }

  const route = resolveScriptWaypointRouteByPathLabel(self, waypointPathLabel, entity.x, entity.z);
  if (!route || route.length === 0) {
    return false;
  }

  const weaponSlot = self.findWaypointFollowingCapableWeaponSlot(entity);
  if (weaponSlot === null) {
    return false;
  }

  const registry = self.iniDataRegistry;
  if (!registry) {
    return false;
  }

  const weapon = self.resolveAttackWeaponProfileForSetSelection(
    entity.weaponTemplateSets,
    entity.weaponSetFlagsMask,
    registry,
    weaponSlot,
  );
  if (!weapon || !weapon.projectileObjectName) {
    return false;
  }

  self.queueWaypointPathProjectileEvent(entity, weapon, route);
  return true;
}

export function buildScriptProjectileWaypointPath(self: GL, 
  sourceX: number,
  sourceZ: number,
  route: readonly ScriptWaypointRouteNode[],
): VectorXZ[] {
  const path: VectorXZ[] = [{ x: sourceX, z: sourceZ }];
  for (const waypoint of route) {
    path.push({ x: waypoint.x, z: waypoint.z });
  }
  return path;
}

export function executeScriptNamedFollowWaypoints(self: GL, 
  entityId: number,
  waypointPathLabel: string,
  exact: boolean,
): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed || !entity.canMove) {
    return false;
  }

  const route = resolveScriptWaypointRouteByPathLabel(self, 
    waypointPathLabel,
    entity.x,
    entity.z,
    exact,
  );
  if (!route || route.length === 0) {
    return false;
  }

  self.setEntityLocomotorSet(entity.id, LOCOMOTORSET_NORMAL);
  if (exact) {
    return enqueueScriptWaypointRouteExact(self, entity, route, waypointPathLabel);
  }
  return enqueueScriptWaypointRoute(self, entity, route, waypointPathLabel);
}

export function executeScriptTeamFollowWaypoints(self: GL, 
  teamName: string,
  waypointPathLabel: string,
  asTeam: boolean,
  exact: boolean,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const allTeamMembers = getScriptTeamMemberEntities(self, team)
    .filter((entity) => !entity.destroyed);
  if (allTeamMembers.length === 0) {
    return false;
  }

  const teamMembers = allTeamMembers.filter((entity) => entity.canMove);
  if (teamMembers.length === 0) {
    return false;
  }

  const center = resolveScriptTeamCenter(self, allTeamMembers);
  if (!center) {
    return false;
  }

  const route = resolveScriptWaypointRouteByPathLabel(self, 
    waypointPathLabel,
    center.x,
    center.z,
    exact,
  );
  if (!route || route.length === 0) {
    return false;
  }

  let movedAny = false;
  for (const entity of teamMembers) {
    const routeToUse = asTeam
      ? buildScriptWaypointRouteWithOffset(self, route, entity.x - center.x, entity.z - center.z)
      : route;
    const moved = exact
      ? enqueueScriptWaypointRouteExact(self, entity, routeToUse, waypointPathLabel)
      : enqueueScriptWaypointRoute(self, entity, routeToUse, waypointPathLabel);
    if (moved) {
      movedAny = true;
    }
  }
  return movedAny;
}

export function buildScriptWaypointRouteWithOffset(self: GL, 
  route: readonly ScriptWaypointRouteNode[],
  offsetX: number,
  offsetZ: number,
): ScriptWaypointRouteNode[] {
  if (offsetX === 0 && offsetZ === 0) {
    return route.map((node) => ({
      x: node.x,
      z: node.z,
      pathLabels: [...node.pathLabels],
    }));
  }
  return route.map((node) => ({
    x: node.x + offsetX,
    z: node.z + offsetZ,
    pathLabels: [...node.pathLabels],
  }));
}

export function enqueueScriptWaypointRouteExact(self: GL, 
  entity: MapEntity,
  route: readonly ScriptWaypointRouteNode[],
  _completionPathName?: string,
): boolean {
  if (route.length === 0) {
    return false;
  }

  self.cancelEntityCommandPathActions(entity.id);
  self.clearAttackTarget(entity.id);

  const directPath: VectorXZ[] = [{ x: entity.x, z: entity.z }];
  for (const waypoint of route) {
    directPath.push({ x: waypoint.x, z: waypoint.z });
  }

  entity.moving = true;
  entity.movePath = directPath;
  entity.pathIndex = 0;
  entity.moveTarget = entity.movePath[0]!;
  self.updatePathfindGoalCellFromPath(entity);

  const completionPathNames = resolveScriptWaypointCompletionPathNames(self, route, 'START');
  if (completionPathNames.length > 0) {
    self.scriptPendingWaypointPathByEntityId.set(entity.id, {
      pathNames: completionPathNames,
      completionMode: 'ON_STATE_EXIT',
    });
  } else {
    self.scriptPendingWaypointPathByEntityId.delete(entity.id);
  }
  return true;
}

export function findScriptBuildDozerForTemplate(self: GL, side: string, templateName: string): MapEntity | null {
  let bestDozer: MapEntity | null = null;
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    if (self.normalizeSide(entity.side) !== side) continue;
    if (self.pendingConstructionActions.has(entity.id) || self.pendingRepairActions.has(entity.id)) continue;
    if (!self.isEntityDozerCapable(entity)) continue;
    if (!self.canEntityIssueBuildCommandForTemplate(entity, templateName, ['DOZER_CONSTRUCT', 'UNIT_BUILD'])) {
      continue;
    }
    if (!bestDozer || entity.id < bestDozer.id) {
      bestDozer = entity;
    }
  }
  return bestDozer;
}

export function resolveScriptSkirmishDefenseTemplateName(self: GL, side: string): string | null {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    if (self.normalizeSide(entity.side) !== side) continue;
    if (self.pendingConstructionActions.has(entity.id) || self.pendingRepairActions.has(entity.id)) continue;
    if (!self.isEntityDozerCapable(entity)) continue;

    let buildableTemplates = self.collectCommandSetTemplates(entity, ['DOZER_CONSTRUCT', 'UNIT_BUILD']);
    if (buildableTemplates.length === 0 && entity.productionProfile) {
      buildableTemplates = entity.productionProfile.quantityModifiers
        .filter((modifier) => {
          const upper = modifier.templateName.trim().toUpperCase();
          return upper.length > 0 && !upper.includes('UPGRADE') && !upper.includes('SCIENCE');
        })
        .map((modifier) => modifier.templateName);
    }

    for (const templateName of buildableTemplates) {
      if (isScriptSkirmishDefenseTemplateName(self, templateName)) {
        return templateName;
      }
    }
  }
  return null;
}

export function isScriptSkirmishDefenseTemplateName(self: GL, templateName: string): boolean {
  const normalizedTemplate = templateName.trim().toUpperCase();
  if (!normalizedTemplate) {
    return false;
  }

  for (const keyword of SCRIPT_SKIRMISH_DEFENSE_TEMPLATE_KEYWORDS) {
    if (normalizedTemplate.includes(keyword)) {
      return true;
    }
  }
  return false;
}

export function executeScriptTeamFollowSkirmishApproachPath(self: GL, 
  teamName: string,
  waypointPathLabel: string,
  asTeam: boolean,
  explicitPlayerSide: string,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const side = resolveScriptCurrentPlayerSide(self, explicitPlayerSide);
  if (!side) {
    return false;
  }

  const allTeamMembers = getScriptTeamMemberEntities(self, team)
    .filter((entity) => !entity.destroyed);
  if (allTeamMembers.length === 0) {
    return false;
  }

  const teamMembers = allTeamMembers.filter((entity) => entity.canMove);
  if (teamMembers.length === 0) {
    return false;
  }

  const center = resolveScriptTeamCenter(self, allTeamMembers);
  if (!center) {
    return false;
  }

  const route = resolveScriptSkirmishApproachRoute(self, 
    waypointPathLabel,
    side,
    center.x,
    center.z,
  );
  if (!route || route.length === 0) {
    return false;
  }

  const firstUnit = allTeamMembers[0] ?? null;
  if (firstUnit) {
    self.checkScriptSkirmishApproachPathBridges(side, firstUnit, route);
  }

  let movedAny = false;
  for (const entity of teamMembers) {
    const routeToUse = asTeam
      ? buildScriptWaypointRouteWithOffset(self, route, entity.x - center.x, entity.z - center.z)
      : route;
    if (enqueueScriptWaypointRoute(self, entity, routeToUse)) {
      movedAny = true;
    }
  }
  return movedAny;
}

export function findScriptBrokenBridgeRepairTarget(self: GL, 
  startX: number,
  startZ: number,
  targetX: number,
  targetZ: number,
  mover: MapEntity,
): number | null {
  for (const [segmentId, segment] of self.bridgeSegments.entries()) {
    if (segment.passable) {
      continue;
    }
    const pathExistsIfRepaired = self.withTemporarilyPassableBridgeSegment(segmentId, () => {
      const repairedPath = self.findPath(startX, startZ, targetX, targetZ, mover);
      return repairedPath.length > 0;
    });
    if (!pathExistsIfRepaired) {
      continue;
    }
    const repairControlEntityId = resolveScriptBridgeRepairControlEntityId(self, segmentId);
    if (repairControlEntityId !== null) {
      return repairControlEntityId;
    }
  }
  return null;
}

export function resolveScriptBridgeRepairControlEntityId(self: GL, segmentId: number): number | null {
  let bridgeEntityId: number | null = null;
  for (const [entityId, mappedSegmentId] of self.bridgeSegmentByControlEntity.entries()) {
    if (mappedSegmentId !== segmentId) {
      continue;
    }
    const controlEntity = self.spawnedEntities.get(entityId);
    if (!controlEntity || controlEntity.destroyed) {
      continue;
    }
    if (controlEntity.kindOf.has('BRIDGE_TOWER')) {
      return entityId;
    }
    if (bridgeEntityId === null) {
      bridgeEntityId = entityId;
    }
  }
  return bridgeEntityId;
}

export function executeScriptTeamMoveToSkirmishApproachPath(self: GL, 
  teamName: string,
  waypointPathLabel: string,
  explicitPlayerSide: string,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const side = resolveScriptCurrentPlayerSide(self, explicitPlayerSide);
  if (!side) {
    return false;
  }

  const allTeamMembers = getScriptTeamMemberEntities(self, team)
    .filter((entity) => !entity.destroyed);
  if (allTeamMembers.length === 0) {
    return false;
  }

  const teamMembers = allTeamMembers.filter((entity) => entity.canMove);
  if (teamMembers.length === 0) {
    return false;
  }

  const center = resolveScriptTeamCenter(self, allTeamMembers);
  if (!center) {
    return false;
  }

  const route = resolveScriptSkirmishApproachRoute(self, 
    waypointPathLabel,
    side,
    center.x,
    center.z,
  );
  if (!route || route.length === 0) {
    return false;
  }

  const firstWaypoint = route[0]!;
  let movedAny = false;
  for (const entity of teamMembers) {
    self.applyCommand({
      type: 'moveTo',
      entityId: entity.id,
      targetX: firstWaypoint.x,
      targetZ: firstWaypoint.z,
      commandSource: 'SCRIPT',
    });
    if (entity.moving) {
      movedAny = true;
    }
  }
  return movedAny;
}

export function resolveScriptTeamCenter(self: GL, 
  teamMembers: readonly MapEntity[],
): { x: number; z: number } | null {
  if (teamMembers.length === 0) {
    return null;
  }
  let sumX = 0;
  let sumZ = 0;
  for (const member of teamMembers) {
    sumX += member.x;
    sumZ += member.z;
  }
  return {
    x: sumX / teamMembers.length,
    z: sumZ / teamMembers.length,
  };
}

export function resolveScriptAIGroupCenter(self: GL, 
  teamMembers: readonly MapEntity[],
): { x: number; z: number } | null {
  if (teamMembers.length === 0) {
    return null;
  }

  let sumX = 0;
  let sumZ = 0;
  let count = 0;
  for (const member of teamMembers) {
    if (member.objectStatusFlags.has('DISABLED_HELD')) {
      continue;
    }
    if (!member.canMove) {
      continue;
    }
    sumX += member.x;
    sumZ += member.z;
    count += 1;
  }

  if (count === 0) {
    for (const member of teamMembers) {
      if (member.objectStatusFlags.has('DISABLED_HELD')) {
        continue;
      }
      sumX += member.x;
      sumZ += member.z;
      count += 1;
    }
  }

  if (count <= 0) {
    return null;
  }
  return {
    x: sumX / count,
    z: sumZ / count,
  };
}

export function resolveScriptSkirmishApproachRoute(self: GL, 
  waypointPathLabel: string,
  currentPlayerSide: string,
  centerX: number,
  centerZ: number,
  exactRoute = false,
): ScriptWaypointRouteNode[] | null {
  const basePathLabel = waypointPathLabel.trim();
  if (!basePathLabel) {
    return null;
  }

  const enemySide = resolveScriptSkirmishEnemySide(self, currentPlayerSide);
  if (!enemySide) {
    return null;
  }
  const enemyStartPosition = self.getSkirmishPlayerStartPosition(enemySide);
  if (enemyStartPosition === null) {
    return null;
  }

  const fullPathLabel = `${basePathLabel}${enemyStartPosition}`.trim().toUpperCase();
  if (!fullPathLabel) {
    return null;
  }
  return resolveScriptWaypointRouteByNormalizedLabel(self, fullPathLabel, centerX, centerZ, exactRoute);
}

export function resolveScriptWaypointRouteByPathLabel(self: GL, 
  waypointPathLabel: string,
  centerX: number,
  centerZ: number,
  exactRoute = false,
): ScriptWaypointRouteNode[] | null {
  const normalizedPathLabel = waypointPathLabel.trim().toUpperCase();
  if (!normalizedPathLabel) {
    return null;
  }
  return resolveScriptWaypointRouteByNormalizedLabel(self, normalizedPathLabel, centerX, centerZ, exactRoute);
}

export function resolveScriptWaypointRouteByNormalizedLabel(self: GL, 
  normalizedPathLabel: string,
  centerX: number,
  centerZ: number,
  exactRoute = false,
): ScriptWaypointRouteNode[] | null {
  const waypointData = self.loadedMapData?.waypoints;
  if (!waypointData) {
    return null;
  }

  const routeNodes = waypointData.nodes.filter((node) => {
    const labels = [node.pathLabel1, node.pathLabel2, node.pathLabel3];
    for (const label of labels) {
      if (label && label.trim().toUpperCase() === normalizedPathLabel) {
        return true;
      }
    }
    return false;
  });
  if (routeNodes.length === 0) {
    return null;
  }

  let startNode = routeNodes[0]!;
  let bestDistSqr = Infinity;
  for (const node of routeNodes) {
    const dx = node.position.x - centerX;
    const dz = node.position.y - centerZ;
    const distSqr = dx * dx + dz * dz;
    if (distSqr < bestDistSqr) {
      startNode = node;
      bestDistSqr = distSqr;
    }
  }

  const routeNodesById = new Map<number, (typeof routeNodes)[number]>();
  for (const node of routeNodes) {
    routeNodesById.set(node.id, node);
  }

  const outgoingById = new Map<number, number[]>();
  for (const link of waypointData.links) {
    if (!routeNodesById.has(link.waypoint1) || !routeNodesById.has(link.waypoint2)) {
      continue;
    }
    let outgoing = outgoingById.get(link.waypoint1);
    if (!outgoing) {
      outgoing = [];
      outgoingById.set(link.waypoint1, outgoing);
    }
    outgoing.push(link.waypoint2);
  }

  const route: ScriptWaypointRouteNode[] = [];
  let currentNode: (typeof routeNodes)[number] | undefined = startNode;
  if (exactRoute) {
    // Source parity: AIUpdateInterface::setPathFromWaypoint() follows link(0)
    // repeatedly with WAYPOINT_PATH_LIMIT safety cap.
    let count = 0;
    while (currentNode && count < SCRIPT_WAYPOINT_PATH_LIMIT) {
      route.push({
        x: currentNode.position.x,
        z: currentNode.position.y,
        pathLabels: [
          currentNode.pathLabel1 ?? '',
          currentNode.pathLabel2 ?? '',
          currentNode.pathLabel3 ?? '',
        ].filter((label) => label.trim().length > 0),
      });
      count += 1;

      const outgoing = outgoingById.get(currentNode.id);
      if (!outgoing || outgoing.length === 0) {
        break;
      }
      const nextNode = routeNodesById.get(outgoing[0]!);
      if (!nextNode) {
        break;
      }
      currentNode = nextNode;
    }
  } else {
    // Source parity bridge: AIFollowWaypointPathState::getNextWaypoint() in
    // ALLOW_BACKTRACK mode picks a random outgoing link each step (including
    // immediate backtracking). We precompute a capped route here.
    let count = 0;
    while (currentNode && count < SCRIPT_WAYPOINT_PATH_LIMIT) {
      route.push({
        x: currentNode.position.x,
        z: currentNode.position.y,
        pathLabels: [
          currentNode.pathLabel1 ?? '',
          currentNode.pathLabel2 ?? '',
          currentNode.pathLabel3 ?? '',
        ].filter((label) => label.trim().length > 0),
      });
      count += 1;

      const outgoing = outgoingById.get(currentNode.id);
      if (!outgoing || outgoing.length === 0) {
        break;
      }
      const nextIndex = outgoing.length > 1
        ? self.gameRandom.nextRange(0, outgoing.length - 1)
        : 0;
      const nextNode = routeNodesById.get(outgoing[nextIndex]!);
      if (!nextNode) {
        break;
      }
      currentNode = nextNode;
    }
  }

  return route.length > 0 ? route : null;
}

export function resolveScriptSkirmishEnemySide(self: GL, currentPlayerSide: string): string | null {
  const normalizedCurrentSide = self.normalizeSide(currentPlayerSide);
  if (!normalizedCurrentSide) {
    return null;
  }

  const enemySides: string[] = [];
  for (const side of self.collectKnownSides()) {
    if (side === normalizedCurrentSide) {
      continue;
    }
    if (self.getTeamRelationshipBySides(normalizedCurrentSide, side) !== RELATIONSHIP_ENEMIES) {
      continue;
    }
    enemySides.push(side);
  }

  if (enemySides.length === 0) {
    return null;
  }

  const humanEnemy = enemySides.find((side) => self.getSidePlayerType(side) === 'HUMAN');
  if (humanEnemy) {
    return humanEnemy;
  }

  return enemySides[0] ?? null;
}

export function enqueueScriptWaypointRoute(self: GL, 
  entity: MapEntity,
  route: readonly ScriptWaypointRouteNode[],
  _completionPathName?: string,
): boolean {
  if (route.length === 0) {
    return false;
  }

  const firstWaypoint = route[0]!;
  self.applyCommand({
    type: 'moveTo',
    entityId: entity.id,
    targetX: firstWaypoint.x,
    targetZ: firstWaypoint.z,
    commandSource: 'SCRIPT',
  });
  if (!entity.moving) {
    self.scriptPendingWaypointPathByEntityId.delete(entity.id);
    return false;
  }

  if (route.length > 1) {
    for (let index = 1; index < route.length; index += 1) {
      const waypoint = route[index]!;
      entity.movePath.push({ x: waypoint.x, z: waypoint.z });
    }
  }

  const completionPathNames = resolveScriptWaypointCompletionPathNames(self, route);
  if (completionPathNames.length > 0) {
    self.scriptPendingWaypointPathByEntityId.set(entity.id, {
      pathNames: completionPathNames,
      completionMode: 'ON_REACH_END',
    });
  } else {
    self.scriptPendingWaypointPathByEntityId.delete(entity.id);
  }
  return true;
}

export function resolveScriptWaypointCompletionPathNames(self: GL, 
  route: readonly ScriptWaypointRouteNode[],
  completionNode: 'START' | 'END' = 'END',
): string[] {
  const completionNames = new Set<string>();

  const waypoint = completionNode === 'START'
    ? route[0]
    : route[route.length - 1];
  if (waypoint) {
    for (const pathLabel of waypoint.pathLabels) {
      const normalizedLabel = normalizeScriptCompletionName(self, pathLabel);
      if (normalizedLabel) {
        completionNames.add(normalizedLabel);
      }
    }
  }

  return Array.from(completionNames);
}

export function getScriptActionHumanSides(self: GL): Set<string> {
  const sides = new Set<string>();
  for (const [side, playerType] of self.sidePlayerTypes.entries()) {
    if (playerType === 'HUMAN') {
      sides.add(side);
    }
  }
  return sides;
}

export function executeScriptIdleAllUnits(self: GL): boolean {
  const humanSides = getScriptActionHumanSides(self);
  if (humanSides.size === 0) {
    return true;
  }

  for (const side of humanSides) {
    self.sideUnitsShouldIdleOrResume.set(side, true);
  }

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || !entity.canMove) {
      continue;
    }
    const side = self.normalizeSide(entity.side);
    if (!side || !humanSides.has(side)) {
      continue;
    }
    self.applyCommand({ type: 'stop', entityId: entity.id, commandSource: 'SCRIPT' });
  }
  return true;
}

export function executeScriptResumeSupplyTrucking(self: GL): boolean {
  const humanSides = getScriptActionHumanSides(self);
  if (humanSides.size === 0) {
    return true;
  }

  for (const side of humanSides) {
    self.sideUnitsShouldIdleOrResume.set(side, false);
  }

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || !entity.supplyTruckProfile) {
      continue;
    }
    const side = self.normalizeSide(entity.side);
    if (!side || !humanSides.has(side)) {
      continue;
    }
    const state = self.supplyTruckStates.get(entity.id);
    if (!state) {
      continue;
    }
    state.aiState = SupplyTruckAIState.IDLE;
    state.targetWarehouseId = null;
    state.targetDepotId = null;
    state.actionDelayFinishFrame = self.frameCounter;
    state.forceBusy = false;
  }
  return true;
}

export function executeScriptNamedStop(self: GL, entityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  self.applyCommand({ type: 'stop', entityId, commandSource: 'SCRIPT' });
  return true;
}

export function executeScriptTeamStop(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    self.applyCommand({ type: 'stop', entityId: entity.id, commandSource: 'SCRIPT' });
  }
  return true;
}

export function executeScriptNamedGuard(self: GL, entityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed || !entity.canMove) {
    return false;
  }
  self.setEntityLocomotorSet(entity.id, LOCOMOTORSET_NORMAL);
  self.applyCommand({
    type: 'guardPosition',
    entityId: entity.id,
    targetX: entity.x,
    targetZ: entity.z,
    guardMode: 0,
    commandSource: 'SCRIPT',
  });
  return true;
}

export function executeScriptTeamGuard(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  let issuedAny = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed || !entity.canMove) {
      continue;
    }
    self.applyCommand({
      type: 'guardPosition',
      entityId: entity.id,
      targetX: entity.x,
      targetZ: entity.z,
      guardMode: 0,
      commandSource: 'SCRIPT',
    });
    issuedAny = true;
  }
  return issuedAny;
}

export function executeScriptTeamGuardPosition(self: GL, teamName: string, waypointName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  if (!team || !waypoint) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    self.applyCommand({
      type: 'guardPosition',
      entityId: entity.id,
      targetX: waypoint.x,
      targetZ: waypoint.z,
      guardMode: 0,
      commandSource: 'SCRIPT',
    });
  }
  return true;
}

export function executeScriptTeamGuardObject(self: GL, teamName: string, targetEntityId: number): boolean {
  const team = getScriptTeamRecord(self, teamName);
  const target = self.spawnedEntities.get(targetEntityId);
  if (!team || !target || target.destroyed) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    self.applyCommand({
      type: 'guardObject',
      entityId: entity.id,
      targetEntityId: target.id,
      guardMode: 0,
      commandSource: 'SCRIPT',
    });
  }
  return true;
}

export function executeScriptTeamGuardSupplyCenter(self: GL, teamName: string, minimumCash: number): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const controllingSide = resolveScriptTeamControllingSide(self, team);
  if (!controllingSide) {
    return false;
  }
  const supplySource = findScriptSupplySourceForSide(self, controllingSide, minimumCash);
  if (!supplySource) {
    return false;
  }
  return executeScriptTeamGuardObject(self, team.nameUpper, supplySource.id);
}

export function executeScriptTeamGuardInTunnelNetwork(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  let issuedAny = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed || self.isEntityContained(entity)) {
      continue;
    }
    const tunnel = self.findNearestFriendlyTunnelNetworkForEntity(entity);
    if (!tunnel) {
      continue;
    }
    self.applyCommand({
      type: 'enterTransport',
      entityId: entity.id,
      targetTransportId: tunnel.id,
      commandSource: 'SCRIPT',
    });
    issuedAny = true;
  }
  return issuedAny;
}

export function executeScriptTeamGuardArea(self: GL, teamName: string, triggerName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  const area = resolveScriptTriggerAreaByName(self, triggerName);
  if (!team || !area) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    self.initGuardArea(
      entity.id,
      area.triggerIndex,
      area.centerX,
      area.centerZ,
      0,
      area.radius,
    );
  }
  return true;
}

export function executeScriptNamedFaceNamed(self: GL, entityId: number, targetEntityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  const target = self.spawnedEntities.get(targetEntityId);
  if (!entity || !target || entity.destroyed || target.destroyed) {
    return false;
  }
  self.faceEntityTowardPosition(entity, target.x, target.z);
  return true;
}

export function executeScriptNamedFaceWaypoint(self: GL, entityId: number, waypointName: string): boolean {
  const entity = self.spawnedEntities.get(entityId);
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  if (!entity || entity.destroyed || !waypoint) {
    return false;
  }
  self.faceEntityTowardPosition(entity, waypoint.x, waypoint.z);
  return true;
}

export function executeScriptTeamFaceNamed(self: GL, teamName: string, targetEntityId: number): boolean {
  const team = getScriptTeamRecord(self, teamName);
  const target = self.spawnedEntities.get(targetEntityId);
  if (!team || !target || target.destroyed) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    self.faceEntityTowardPosition(entity, target.x, target.z);
  }
  return true;
}

export function executeScriptTeamFaceWaypoint(self: GL, teamName: string, waypointName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  if (!team || !waypoint) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    self.faceEntityTowardPosition(entity, waypoint.x, waypoint.z);
  }
  return true;
}

export function executeScriptMoveUnitTowardsNearestObjectType(self: GL, 
  entityId: number,
  objectTypeName: string,
  triggerName: string,
): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed || !entity.canMove) {
    return false;
  }

  const target = self.findNearestScriptMoveTargetByType(
    entity.x,
    entity.z,
    entity,
    objectTypeName,
    triggerName,
  );
  if (!target) {
    return false;
  }

  self.setEntityLocomotorSet(entity.id, LOCOMOTORSET_NORMAL);
  const interactionDistance = self.resolveEntityInteractionDistance(entity, target);
  self.issueMoveTo(
    entity.id,
    target.x,
    target.z,
    interactionDistance,
  );
  if (entity.moveTarget === null) {
    self.issueMoveTo(entity.id, target.x, target.z, interactionDistance, true);
  }
  return true;
}

export function executeScriptMoveTeamTowardsNearestObjectType(self: GL, 
  teamName: string,
  objectTypeName: string,
  triggerName: string,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const teamMembers = getScriptTeamMemberEntities(self, team);
  if (teamMembers.length === 0) {
    return false;
  }

  let movedAny = false;
  // Source parity: Team::getEstimateTeamPosition returns the first team member position.
  const estimatedAnchor = teamMembers[0] ?? null;
  if (!estimatedAnchor) {
    return movedAny;
  }
  // Source parity: doMoveTeamTowardsNearest selects map-status filter seed from the
  // first team member with AIUpdateInterface.
  let mapStatusEntity: MapEntity | null = null;
  for (const member of teamMembers) {
    if (member.destroyed || !member.canMove) {
      continue;
    }
    mapStatusEntity = member;
    break;
  }
  if (!mapStatusEntity) {
    return movedAny;
  }

  const target = self.findNearestScriptMoveTargetByType(
    estimatedAnchor.x,
    estimatedAnchor.z,
    mapStatusEntity,
    objectTypeName,
    triggerName,
  );
  if (!target) {
    return movedAny;
  }

  for (const member of teamMembers) {
    if (member.destroyed || !member.canMove) {
      return movedAny;
    }
    self.setEntityLocomotorSet(member.id, LOCOMOTORSET_NORMAL);
    const interactionDistance = self.resolveEntityInteractionDistance(member, target);
    self.issueMoveTo(
      member.id,
      target.x,
      target.z,
      interactionDistance,
    );
    if (member.moveTarget === null) {
      self.issueMoveTo(member.id, target.x, target.z, interactionDistance, true);
    }
    if (member.moving) {
      movedAny = true;
    }
  }

  return movedAny;
}

export function executeScriptObjectForceSelect(self: GL, 
  teamName: string,
  objectTypeName: string,
  centerInView: boolean,
  audioToPlay: string,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }
  const objectTypeUpper = objectTypeName.trim().toUpperCase();
  if (!objectTypeUpper) {
    return false;
  }

  let bestGuess: MapEntity | null = null;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    if (entity.templateName.trim().toUpperCase() !== objectTypeUpper) {
      continue;
    }
    if (!bestGuess || entity.id < bestGuess.id) {
      bestGuess = entity;
    }
  }

  if (!bestGuess) {
    return false;
  }

  self.selectedEntityIds = [bestGuess.id];
  self.selectedEntityId = bestGuess.id;
  self.updateSelectionHighlight();

  if (centerInView) {
    self.requestScriptCameraModMoveToSelection();
  }

  const normalizedAudioName = audioToPlay.trim();
  if (normalizedAudioName) {
    self.requestScriptPlaySoundEffect(normalizedAudioName);
  }

  return true;
}

export function executeScriptUnitDestroyAllContained(self: GL, containerEntityId: number): boolean {
  const container = self.spawnedEntities.get(containerEntityId);
  if (!container || container.destroyed) {
    return false;
  }

  const containedIds = self.collectContainedEntityIds(container.id);
  for (const passengerId of containedIds) {
    const passenger = self.spawnedEntities.get(passengerId);
    if (!passenger || passenger.destroyed) {
      continue;
    }
    self.applyWeaponDamageAmount(null, passenger, passenger.maxHealth, 'UNRESISTABLE');
  }
  return true;
}

export function resolveScriptContainerCapacity(self: GL, container: MapEntity): number {
  const contain = container.containProfile;
  if (!contain) {
    return 0;
  }
  switch (contain.moduleType) {
    case 'GARRISON':
      return contain.garrisonCapacity;
    case 'TUNNEL':
      return self.config.maxTunnelCapacity;
    default:
      return contain.transportCapacity;
  }
}

export function resolveScriptContainedControllingPlayerToken(self: GL, container: MapEntity): string | null {
  for (const passengerId of self.collectContainedEntityIds(container.id)) {
    const passenger = self.spawnedEntities.get(passengerId);
    if (!passenger || passenger.destroyed) {
      continue;
    }
    const ownerToken = self.resolveEntityControllingPlayerTokenForAffiliation(passenger);
    if (ownerToken) {
      return ownerToken;
    }
  }
  return null;
}

export function isScriptInternetCenterBuilding(self: GL, entity: MapEntity): boolean {
  const kindOf = self.resolveEntityKindOfSet(entity);
  return kindOf.has('FS_INTERNET_CENTER') || entity.containProfile?.moduleType === 'INTERNET_HACK';
}

export function executeScriptNamedEnterNamed(self: GL, entityId: number, targetContainerEntityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  const container = self.spawnedEntities.get(targetContainerEntityId);
  if (!entity || !container || entity.destroyed || container.destroyed) {
    return false;
  }
  // Source parity: ScriptActions::doNamedEnterNamed chooses LOCOMOTORSET_NORMAL
  // before issuing aiEnter.
  self.setEntityLocomotorSet(entity.id, LOCOMOTORSET_NORMAL);
  return self.issueScriptEnterContainer(entity, container);
}

export function executeScriptTeamEnterNamed(self: GL, teamName: string, targetContainerEntityId: number): boolean {
  const team = getScriptTeamRecord(self, teamName);
  const container = self.spawnedEntities.get(targetContainerEntityId);
  if (!team || !container || container.destroyed) {
    return false;
  }

  let issuedAny = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    if (self.issueScriptEnterContainer(entity, container)) {
      issuedAny = true;
    }
  }
  return issuedAny;
}

export function executeScriptNamedExitAll(self: GL, entityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed || !entity.containProfile) {
    return false;
  }
  // Source parity: ScriptActions::doNamedExitAll chooses LOCOMOTORSET_NORMAL
  // before issuing aiEvacuate.
  self.setEntityLocomotorSet(entity.id, LOCOMOTORSET_NORMAL);
  self.applyCommand({
    type: 'evacuate',
    entityId: entity.id,
  });
  return true;
}

export function executeScriptTeamExitAll(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  let issuedAny = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed || !entity.containProfile) {
      continue;
    }
    self.applyCommand({
      type: 'evacuate',
      entityId: entity.id,
    });
    issuedAny = true;
  }
  return issuedAny;
}

export function findScriptNearestGarrisonBuilding(self: GL, 
  source: MapEntity,
  requireInternetCenter: boolean,
): MapEntity | null {
  const ownerToken = self.resolveEntityControllingPlayerTokenForAffiliation(source);
  if (!ownerToken) {
    return null;
  }
  const sourceOffMap = self.isEntityOffMap(source);

  let nearest: MapEntity | null = null;
  let nearestDistSq = Number.POSITIVE_INFINITY;

  for (const candidate of self.spawnedEntities.values()) {
    if (candidate.destroyed || candidate.id === source.id) {
      continue;
    }
    if (self.isEntityOffMap(candidate) !== sourceOffMap) {
      continue;
    }
    if (!self.canScriptOwnerUseBuildingContainer(candidate, ownerToken)) {
      continue;
    }
    const isInternetCenter = isScriptInternetCenterBuilding(self, candidate);
    if (requireInternetCenter) {
      if (!isInternetCenter) {
        continue;
      }
    } else if (isInternetCenter) {
      continue;
    }

    const capacity = resolveScriptContainerCapacity(self, candidate);
    if (capacity > 0 && self.collectContainedEntityIds(candidate.id).length >= capacity) {
      continue;
    }

    const dx = candidate.x - source.x;
    const dz = candidate.z - source.z;
    const distSq = (dx * dx) + (dz * dz);
    if (
      distSq < nearestDistSq
      || (distSq === nearestDistSq && nearest !== null && candidate.id < nearest.id)
      || (distSq === nearestDistSq && nearest === null)
    ) {
      nearest = candidate;
      nearestDistSq = distSq;
    }
  }

  return nearest;
}

export function executeScriptTeamGarrisonSpecificBuilding(self: GL, teamName: string, buildingEntityId: number): boolean {
  const team = getScriptTeamRecord(self, teamName);
  const building = self.spawnedEntities.get(buildingEntityId);
  if (!team || !building || building.destroyed) {
    return false;
  }

  const teamMembers = getScriptTeamMemberEntities(self, team).filter((entity) => !entity.destroyed);
  const sourceMember = teamMembers[0];
  if (!sourceMember) {
    return false;
  }

  let issuedAny = false;
  const controllingOwnerToken = resolveScriptTeamControllingPlayerTokenForAffiliation(self, team, sourceMember);
  if (!self.canScriptOwnerUseBuildingContainer(building, controllingOwnerToken)) {
    return false;
  }
  for (const member of teamMembers) {
    if (self.issueScriptEnterContainer(member, building)) {
      issuedAny = true;
    }
  }
  return issuedAny;
}

export function executeScriptTeamGarrisonNearestBuilding(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  return executeScriptSingleTeamGarrisonNearestBuilding(self, team);
}

export function executeScriptSingleTeamGarrisonNearestBuilding(self: GL, 
  team: ScriptTeamRecord,
  handledEntityIds: Set<number> | null = null,
): boolean {
  const teamMembers = getScriptTeamMemberEntities(self, team)
    .filter((entity) => !entity.destroyed && (handledEntityIds ? !handledEntityIds.has(entity.id) : true));
  if (teamMembers.length === 0) {
    return false;
  }

  const leader = teamMembers[0]!;
  const controllingOwnerToken = resolveScriptTeamControllingPlayerTokenForAffiliation(self, team, leader);
  if (!controllingOwnerToken) {
    return false;
  }
  const requireInternetCenter = self.resolveEntityKindOfSet(leader).has('MONEY_HACKER');
  const leaderOffMap = self.isEntityOffMap(leader);
  const candidates = Array.from(self.spawnedEntities.values())
    .filter((candidate) => {
      if (candidate.destroyed) {
        return false;
      }
      if (self.isEntityOffMap(candidate) !== leaderOffMap) {
        return false;
      }
      if (!self.canScriptOwnerUseBuildingContainer(candidate, controllingOwnerToken)) {
        return false;
      }
      const isInternetCenter = isScriptInternetCenterBuilding(self, candidate);
      if (requireInternetCenter) {
        if (!isInternetCenter) {
          return false;
        }
      } else if (isInternetCenter) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const leftDx = left.x - leader.x;
      const leftDz = left.z - leader.z;
      const rightDx = right.x - leader.x;
      const rightDz = right.z - leader.z;
      const leftDistSq = (leftDx * leftDx) + (leftDz * leftDz);
      const rightDistSq = (rightDx * rightDx) + (rightDz * rightDz);
      if (leftDistSq !== rightDistSq) {
        return leftDistSq - rightDistSq;
      }
      return left.id - right.id;
    });

  let memberIndex = 0;
  let issuedAny = false;
  for (const building of candidates) {
    const capacity = resolveScriptContainerCapacity(self, building);
    if (capacity <= 0) {
      continue;
    }
    const occupants = self.collectContainedEntityIds(building.id).length;
    let slotsAvailable = capacity - occupants;
    while (slotsAvailable > 0 && memberIndex < teamMembers.length) {
      const member = teamMembers[memberIndex]!;
      memberIndex += 1;
      const kindOf = self.resolveEntityKindOfSet(member);
      if (!kindOf.has('INFANTRY') || kindOf.has('NO_GARRISON')) {
        continue;
      }
      if (self.issueScriptEnterContainer(member, building)) {
        handledEntityIds?.add(member.id);
        issuedAny = true;
        slotsAvailable -= 1;
      }
    }
    if (memberIndex >= teamMembers.length) {
      break;
    }
  }

  return issuedAny;
}

export function executeScriptNamedGarrisonSpecificBuilding(self: GL, entityId: number, buildingEntityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  const building = self.spawnedEntities.get(buildingEntityId);
  if (!entity || !building || entity.destroyed || building.destroyed) {
    return false;
  }
  const ownerToken = self.resolveEntityControllingPlayerTokenForAffiliation(entity);
  if (!ownerToken) {
    return false;
  }
  if (!self.canScriptOwnerUseBuildingContainer(building, ownerToken)) {
    return false;
  }
  return self.issueScriptEnterContainer(entity, building);
}

export function executeScriptNamedGarrisonNearestBuilding(self: GL, entityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  const requireInternetCenter = self.resolveEntityKindOfSet(entity).has('MONEY_HACKER');
  const nearest = findScriptNearestGarrisonBuilding(self, entity, requireInternetCenter);
  if (!nearest) {
    return false;
  }
  return self.issueScriptEnterContainer(entity, nearest);
}

export function executeScriptPlayerGarrisonAllBuildings(self: GL, playerSide: string): boolean {
  const normalizedSide = resolveScriptRevealMapTargetSide(self, playerSide);
  if (!normalizedSide) {
    return false;
  }

  let issuedAny = false;
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (self.normalizeSide(entity.side) !== normalizedSide) {
      continue;
    }
    if (self.isEntityContained(entity)) {
      continue;
    }
    const kindOf = self.resolveEntityKindOfSet(entity);
    if (!kindOf.has('INFANTRY') || kindOf.has('NO_GARRISON')) {
      continue;
    }

    const requireInternetCenter = kindOf.has('MONEY_HACKER');
    const nearest = findScriptNearestGarrisonBuilding(self, entity, requireInternetCenter);
    if (!nearest) {
      continue;
    }
    if (self.issueScriptEnterContainer(entity, nearest)) {
      issuedAny = true;
    }
  }

  return issuedAny;
}

export function executeScriptPlayerExitAllBuildings(self: GL, playerSide: string): boolean {
  const normalizedSide = resolveScriptRevealMapTargetSide(self, playerSide);
  if (!normalizedSide) {
    return false;
  }

  let issuedAny = false;
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (self.normalizeSide(entity.side) !== normalizedSide) {
      continue;
    }
    if (entity.containProfile && self.collectContainedEntityIds(entity.id).length > 0) {
      self.applyCommand({
        type: 'evacuate',
        entityId: entity.id,
      });
      issuedAny = true;
      continue;
    }
    if (
      entity.garrisonContainerId !== null
      || entity.transportContainerId !== null
      || entity.tunnelContainerId !== null
    ) {
      self.applyCommand({
        type: 'exitContainer',
        entityId: entity.id,
      });
      issuedAny = true;
    }
  }

  return issuedAny;
}

export function executeScriptExitSpecificBuilding(self: GL, containerEntityId: number): boolean {
  const container = self.spawnedEntities.get(containerEntityId);
  if (!container || container.destroyed) {
    return false;
  }
  if (!container.containProfile) {
    return false;
  }
  self.applyCommand({
    type: 'evacuate',
    entityId: container.id,
  });
  return true;
}

export function executeScriptNamedExitBuilding(self: GL, entityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  if (
    entity.garrisonContainerId === null
    && entity.transportContainerId === null
    && entity.tunnelContainerId === null
  ) {
    return false;
  }
  self.applyCommand({
    type: 'exitContainer',
    entityId: entity.id,
  });
  return true;
}

export function executeScriptTeamExitAllBuildings(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  let issuedAny = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    if (entity.containProfile && self.collectContainedEntityIds(entity.id).length > 0) {
      self.applyCommand({
        type: 'evacuate',
        entityId: entity.id,
      });
      issuedAny = true;
      continue;
    }
    if (
      entity.garrisonContainerId !== null
      || entity.transportContainerId !== null
      || entity.tunnelContainerId !== null
    ) {
      self.applyCommand({
        type: 'exitContainer',
        entityId: entity.id,
      });
      issuedAny = true;
    }
  }
  return issuedAny;
}

export function executeScriptNamedSetEvacLeftOrRight(self: GL, entityId: number, disposition: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  if (!entity.containProfile) {
    return false;
  }
  const normalizedDisposition = Math.trunc(disposition);
  entity.scriptEvacDisposition = normalizedDisposition === 1 || normalizedDisposition === 2
    ? normalizedDisposition
    : 0;
  return true;
}

export function setScriptEntityUnmanned(self: GL, entity: MapEntity): void {
  entity.objectStatusFlags.add('DISABLED_UNMANNED');
  entity.attackTargetEntityId = null;
  entity.attackTargetPosition = null;
  if (entity.moving) {
    entity.moving = false;
    entity.moveTarget = null;
    entity.movePath = [];
    entity.pathIndex = 0;
    entity.pathfindGoalCell = null;
  }
  self.unregisterEntityEnergy(entity);
  entity.selected = false;
  entity.side = '';
  entity.controllingPlayerToken = null;
  for (const team of self.scriptTeamsByName.values()) {
    team.memberEntityIds.delete(entity.id);
  }
}

export function executeScriptNamedSetUnmannedStatus(self: GL, entityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  setScriptEntityUnmanned(self, entity);
  return true;
}

export function executeScriptTeamSetUnmannedStatus(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    setScriptEntityUnmanned(self, entity);
  }
  return true;
}

export function applyScriptBoobytrapToEntity(self: GL, boobytrapTemplateName: string, target: MapEntity): boolean {
  const normalizedTemplateName = boobytrapTemplateName.trim();
  if (!normalizedTemplateName) {
    return false;
  }

  const spawnX = target.x;
  const spawnZ = target.z;
  const boobytrap = self.spawnEntityFromTemplate(
    normalizedTemplateName,
    spawnX,
    spawnZ,
    target.rotationY,
    target.side,
  );
  if (!boobytrap) {
    return false;
  }
  if (!boobytrap.stickyBombProfile) {
    return true;
  }

  // Source parity: GeometryInfo::makeRandomOffsetOnPerimeter + object transform matrix.
  const geometry = target.obstacleGeometry;
  const majorRadius = Math.max(0, geometry?.majorRadius ?? target.geometryMajorRadius ?? 0);
  const minorRadius = Math.max(0, geometry?.minorRadius ?? majorRadius);
  const perimeterAngle = self.gameRandom.nextFloat() * (Math.PI * 2);
  const localX = Math.cos(perimeterAngle) * majorRadius;
  const localZ = Math.sin(perimeterAngle) * minorRadius;
  const cosTheta = Math.cos(target.rotationY);
  const sinTheta = Math.sin(target.rotationY);
  boobytrap.x = target.x + (localX * cosTheta) - (localZ * sinTheta);
  boobytrap.z = target.z + (localX * sinTheta) + (localZ * cosTheta);
  if (self.mapHeightmap) {
    boobytrap.y = self.mapHeightmap.getInterpolatedHeight(boobytrap.x, boobytrap.z) ?? boobytrap.y;
  }

  boobytrap.stickyBombTargetId = target.id;
  target.objectStatusFlags.add('BOOBY_TRAPPED');
  return true;
}

export function executeScriptNamedSetBoobytrapped(self: GL, 
  boobytrapTemplateName: string,
  entityId: number,
): boolean {
  const target = self.spawnedEntities.get(entityId);
  if (!target || target.destroyed) {
    return false;
  }
  return applyScriptBoobytrapToEntity(self, boobytrapTemplateName, target);
}

export function executeScriptTeamSetBoobytrapped(self: GL, 
  boobytrapTemplateName: string,
  teamName: string,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  let attachedAny = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    if (applyScriptBoobytrapToEntity(self, boobytrapTemplateName, entity)) {
      attachedAny = true;
    }
  }
  return attachedAny;
}

export function executeScriptNamedSetStealthEnabled(self: GL, entityId: number, enabled: boolean): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }

  if (enabled) {
    entity.objectStatusFlags.delete('SCRIPT_UNSTEALTHED');
  } else {
    entity.objectStatusFlags.add('SCRIPT_UNSTEALTHED');
  }
  return true;
}

export function executeScriptTeamSetStealthEnabled(self: GL, teamName: string, enabled: boolean): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    if (enabled) {
      entity.objectStatusFlags.delete('SCRIPT_UNSTEALTHED');
    } else {
      entity.objectStatusFlags.add('SCRIPT_UNSTEALTHED');
    }
  }
  return true;
}

export function resolveScriptObjectPanelFlagName(self: GL, flagName: string): ScriptObjectPanelFlagName | null {
  const normalized = flagName.trim().toUpperCase();
  switch (normalized) {
    case 'ENABLED':
      return 'ENABLED';
    case 'POWERED':
      return 'POWERED';
    case 'INDESTRUCTIBLE':
      return 'INDESTRUCTIBLE';
    case 'UNSELLABLE':
      return 'UNSELLABLE';
    case 'SELECTABLE':
      return 'SELECTABLE';
    case 'AI RECRUITABLE':
      return 'AI_RECRUITABLE';
    case 'PLAYER TARGETABLE':
      return 'PLAYER_TARGETABLE';
    default:
      return null;
  }
}

export function applyScriptObjectPanelFlag(self: GL, 
  entity: MapEntity,
  flag: ScriptObjectPanelFlagName,
  enabled: boolean,
): void {
  switch (flag) {
    case 'ENABLED':
      if (enabled) {
        entity.objectStatusFlags.delete('SCRIPT_DISABLED');
      } else {
        entity.objectStatusFlags.add('SCRIPT_DISABLED');
      }
      return;
    case 'POWERED':
      if (enabled) {
        entity.objectStatusFlags.delete('SCRIPT_UNPOWERED');
      } else {
        entity.objectStatusFlags.add('SCRIPT_UNPOWERED');
      }
      return;
    case 'INDESTRUCTIBLE':
      entity.isIndestructible = enabled;
      return;
    case 'UNSELLABLE':
      if (enabled) {
        entity.objectStatusFlags.add('SCRIPT_UNSELLABLE');
      } else {
        entity.objectStatusFlags.delete('SCRIPT_UNSELLABLE');
      }
      return;
    case 'SELECTABLE':
      if (enabled) {
        entity.objectStatusFlags.delete('UNSELECTABLE');
      } else {
        entity.objectStatusFlags.add('UNSELECTABLE');
      }
      return;
    case 'AI_RECRUITABLE':
      // Source parity: ScriptActions::changeObjectPanelFlagForSingleObject routes
      // this to AIUpdateInterface::setIsRecruitable.
      entity.scriptAiRecruitable = enabled;
      return;
    case 'PLAYER_TARGETABLE':
      if (enabled) {
        entity.objectStatusFlags.add('SCRIPT_TARGETABLE');
      } else {
        entity.objectStatusFlags.delete('SCRIPT_TARGETABLE');
      }
      return;
  }
}

export function executeScriptAffectObjectPanelFlagsUnit(self: GL, 
  entityId: number,
  flagName: string,
  enabled: boolean,
): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  const flag = resolveScriptObjectPanelFlagName(self, flagName);
  if (!flag) {
    return false;
  }
  applyScriptObjectPanelFlag(self, entity, flag, enabled);
  return true;
}

export function executeScriptAffectObjectPanelFlagsTeam(self: GL, 
  teamName: string,
  flagName: string,
  enabled: boolean,
): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }
  const flag = resolveScriptObjectPanelFlagName(self, flagName);
  if (!flag) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    applyScriptObjectPanelFlag(self, entity, flag, enabled);
  }
  return true;
}

export function executeScriptNamedSetRepulsor(self: GL, entityId: number, repulsor: boolean): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }

  if (repulsor) {
    entity.objectStatusFlags.add('REPULSOR');
    entity.repulsorHelperUntilFrame = self.frameCounter + (2 * LOGIC_FRAME_RATE);
  } else {
    entity.objectStatusFlags.delete('REPULSOR');
    entity.repulsorHelperUntilFrame = 0;
  }
  return true;
}

export function executeScriptTeamSetRepulsor(self: GL, teamName: string, repulsor: boolean): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    if (repulsor) {
      entity.objectStatusFlags.add('REPULSOR');
      entity.repulsorHelperUntilFrame = self.frameCounter + (2 * LOGIC_FRAME_RATE);
    } else {
      entity.objectStatusFlags.delete('REPULSOR');
      entity.repulsorHelperUntilFrame = 0;
    }
  }
  return true;
}

export function executeScriptObjectTypeListMaintenance(self: GL, 
  listName: string,
  objectTypeName: string,
  addObject: boolean,
): boolean {
  const normalizedListName = normalizeScriptObjectTypeName(self, listName);
  const normalizedObjectType = normalizeScriptObjectTypeName(self, objectTypeName);
  if (!normalizedListName || !normalizedObjectType) {
    return false;
  }

  let list = self.scriptObjectTypeListsByName.get(normalizedListName);
  if (!list) {
    if (!addObject) {
      return false;
    }
    list = [];
    self.scriptObjectTypeListsByName.set(normalizedListName, list);
  }

  if (addObject) {
    if (!list.includes(normalizedObjectType)) {
      list.push(normalizedObjectType);
    }
  } else {
    const index = list.indexOf(normalizedObjectType);
    if (index === -1) {
      return false;
    }
    list.splice(index, 1);
    if (list.length === 0) {
      self.scriptObjectTypeListsByName.delete(normalizedListName);
    }
  }

  return true;
}

export function executeScriptTeamWander(self: GL, teamName: string, waypointPathLabel: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  let movedAny = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed || !entity.canMove) {
      continue;
    }
    const route = resolveScriptWaypointRouteByPathLabel(self, 
      waypointPathLabel,
      entity.x,
      entity.z,
    );
    if (!route || route.length === 0) {
      return movedAny;
    }
    self.setEntityLocomotorSet(entity.id, LOCOMOTORSET_WANDER);
    if (enqueueScriptWaypointRoute(self, entity, route, waypointPathLabel)) {
      movedAny = true;
    }
  }
  return movedAny;
}

export function executeScriptTeamPanic(self: GL, teamName: string, waypointPathLabel: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  let movedAny = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed || !entity.canMove) {
      continue;
    }
    const route = resolveScriptWaypointRouteByPathLabel(self, 
      waypointPathLabel,
      entity.x,
      entity.z,
    );
    if (!route || route.length === 0) {
      return movedAny;
    }
    self.setEntityLocomotorSet(entity.id, LOCOMOTORSET_PANIC);
    if (enqueueScriptWaypointRoute(self, entity, route, waypointPathLabel)) {
      movedAny = true;
    }
  }
  return movedAny;
}

export function executeScriptTeamWanderInPlace(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  let activatedAny = false;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed || !entity.canMove) {
      continue;
    }
    self.setEntityLocomotorSet(entity.id, LOCOMOTORSET_WANDER);
    entity.scriptWanderInPlaceActive = true;
    entity.scriptWanderInPlaceOriginX = entity.x;
    entity.scriptWanderInPlaceOriginZ = entity.z;
    setScriptWanderInPlaceGoal(self, entity);
    activatedAny = true;
  }
  return activatedAny;
}

export function executeScriptTeamIncreasePriority(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  team.productionPriority += team.productionPrioritySuccessIncrease;
  return true;
}

export function executeScriptTeamDecreasePriority(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  team.productionPriority -= team.productionPriorityFailureDecrease;
  return true;
}

export function setScriptWanderInPlaceGoal(self: GL, entity: MapEntity): void {
  let delta = 3;
  const locomotor = entity.locomotorSets.get(entity.activeLocomotorSet);
  const radius = locomotor?.wanderAboutPointRadius ?? 0;
  if (radius > 0) {
    delta = Math.max(1, Math.floor((radius / PATHFIND_CELL_SIZE) + 0.5));
  }

  const offsetX = self.gameRandom.nextRange(-delta, delta) * PATHFIND_CELL_SIZE;
  const offsetZ = self.gameRandom.nextRange(-delta, delta) * PATHFIND_CELL_SIZE;
  const targetX = entity.scriptWanderInPlaceOriginX + offsetX;
  const targetZ = entity.scriptWanderInPlaceOriginZ + offsetZ;
  self.issueMoveTo(entity.id, targetX, targetZ);
}

export function setScriptWanderAwayFromRepulsorGoal(self: GL, entity: MapEntity, repulsor: MapEntity): void {
  let awayX = entity.x - repulsor.x;
  let awayZ = entity.z - repulsor.z;
  if ((awayX * awayX) + (awayZ * awayZ) < 1e-6) {
    const angle = self.gameRandom.nextFloat() * Math.PI * 2;
    awayX = Math.cos(angle);
    awayZ = Math.sin(angle);
  }
  const magnitude = Math.hypot(awayX, awayZ);
  if (magnitude <= 0) {
    return;
  }
  const fleeDistance = Math.max(PATHFIND_CELL_SIZE * 2, entity.visionRange);
  const targetX = entity.x + (awayX / magnitude) * fleeDistance;
  const targetZ = entity.z + (awayZ / magnitude) * fleeDistance;
  const [clampedX, clampedZ] = self.clampWorldPositionToMapBounds(targetX, targetZ);
  self.issueMoveTo(entity.id, clampedX, clampedZ);
}

export function clearScriptWanderInPlace(self: GL, entityId: number): void {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity) {
    return;
  }
  entity.scriptWanderInPlaceActive = false;
  entity.modelConditionFlags.delete('PANICKING');
}

export function executeScriptNamedSetHeld(self: GL, entityId: number, held: boolean): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }

  if (held) {
    entity.objectStatusFlags.add('DISABLED_HELD');
  } else {
    entity.objectStatusFlags.delete('DISABLED_HELD');
  }
  return true;
}

export function executeScriptSetTrainHeld(self: GL, entityId: number, held: boolean): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }

  const objectDef = self.resolveObjectDefByTemplateName(entity.templateName);
  if (!self.extractRailedTransportProfile(objectDef ?? undefined)) {
    return false;
  }

  if (!executeScriptNamedSetHeld(self, entityId, held)) {
    return false;
  }
  if (held) {
    self.cancelEntityCommandPathActions(entityId);
    self.stopEntity(entityId);
  }
  return true;
}

export function executeScriptSetObjectAmbientSound(self: GL, entityId: number, enabled: boolean): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  // Source parity: Drawable::enableAmbientSoundFromScript deliberately does not
  // short-circuit repeated toggles so re-enable can retrigger one-shot ambients.
  entity.scriptAmbientSoundRevision += 1;
  entity.scriptAmbientSoundEnabled = enabled;
  return true;
}

export function executeScriptModifyBuildableStatus(self: GL, templateName: string, buildableStatus: BuildableStatus): boolean {
  const objectDef = self.resolveObjectDefByTemplateName(templateName);
  if (!objectDef) {
    return false;
  }

  const normalizedTemplateName = objectDef.name.trim().toUpperCase();
  if (!normalizedTemplateName) {
    return false;
  }

  self.thingTemplateBuildableOverrides.set(normalizedTemplateName, buildableStatus);
  return true;
}

export function executeScriptCommandBarRemoveButtonObjectType(self: GL, 
  buttonName: string,
  objectType: string,
): boolean {
  const registry = self.iniDataRegistry;
  if (!registry) {
    return false;
  }
  const objectDef = self.resolveObjectDefByTemplateName(objectType);
  if (!objectDef) {
    return false;
  }
  const commandSetName = readStringField(objectDef.fields, ['CommandSet'])?.trim().toUpperCase() ?? '';
  if (!commandSetName || commandSetName === 'NONE') {
    return false;
  }
  const commandSetDef = findCommandSetDefByName(registry, commandSetName);
  if (!commandSetDef) {
    return false;
  }
  const normalizedButtonName = buttonName.trim().toUpperCase();
  if (!normalizedButtonName) {
    return false;
  }

  for (let buttonSlot = 1; buttonSlot <= 18; buttonSlot += 1) {
    const slottedButtonName = self.resolveCommandSetSlotButtonName(commandSetDef, buttonSlot);
    if (!slottedButtonName) {
      continue;
    }
    if (slottedButtonName.trim().toUpperCase() !== normalizedButtonName) {
      continue;
    }
    setScriptCommandSetButtonOverride(self, commandSetName, buttonSlot, null);
    return true;
  }

  return false;
}

export function executeScriptCommandBarAddButtonObjectTypeSlot(self: GL, 
  buttonName: string,
  objectType: string,
  slotNum: number,
): boolean {
  const registry = self.iniDataRegistry;
  if (!registry) {
    return false;
  }
  const objectDef = self.resolveObjectDefByTemplateName(objectType);
  if (!objectDef) {
    return false;
  }
  const commandSetName = readStringField(objectDef.fields, ['CommandSet'])?.trim().toUpperCase() ?? '';
  if (!commandSetName || commandSetName === 'NONE') {
    return false;
  }
  const commandButtonDef = findCommandButtonDefByName(registry, buttonName);
  if (!commandButtonDef) {
    return false;
  }

  const slot = Math.trunc(slotNum);
  if (slot < 1 || slot > 18) {
    return false;
  }

  setScriptCommandSetButtonOverride(self, commandSetName, slot, commandButtonDef.name);
  return true;
}

export function executeScriptWarehouseSetValue(self: GL, warehouseEntityId: number, cashValue: number): boolean {
  const warehouse = self.spawnedEntities.get(warehouseEntityId);
  if (!warehouse || warehouse.destroyed || !warehouse.supplyWarehouseProfile) {
    return false;
  }

  const warehouseState = self.supplyWarehouseStates.get(warehouse.id)
    ?? initializeWarehouseStateImpl(warehouse.supplyWarehouseProfile);
  warehouseState.currentBoxes = Math.ceil(cashValue / DEFAULT_SUPPLY_BOX_VALUE);
  self.supplyWarehouseStates.set(warehouse.id, warehouseState);
  return true;
}

export function executeScriptRadarCreateEvent(self: GL, position: unknown, eventType: number): boolean {
  const coord3 = coerceScriptConditionCoord3(self, position);
  if (coord3) {
    recordScriptRadarEvent(self, coord3.x, coord3.z, coord3.y, eventType, null, null);
    return true;
  }

  const waypointName = coerceScriptConditionString(self, position);
  if (!waypointName) {
    return false;
  }
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  if (!waypoint) {
    return false;
  }
  recordScriptRadarEvent(self, 
    waypoint.x,
    self.resolveGroundHeight(waypoint.x, waypoint.z),
    waypoint.z,
    eventType,
    null,
    null,
  );
  return true;
}

export function executeScriptObjectCreateRadarEvent(self: GL, entityId: number, eventType: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }

  recordScriptRadarEvent(self, entity.x, entity.y, entity.z, eventType, entity.id, null);
  return true;
}

export function executeScriptTeamCreateRadarEvent(self: GL, teamName: string, eventType: number): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const teamMembers = getScriptTeamMemberEntities(self, team);
  const hasUnits = teamMembers.some((entity) => isScriptTeamMemberAliveForUnits(self, entity));
  if (!hasUnits) {
    return false;
  }

  const estimatePositionEntity = teamMembers[0];
  if (!estimatePositionEntity) {
    return false;
  }

  recordScriptRadarEvent(self, 
    estimatePositionEntity.x,
    estimatePositionEntity.y,
    estimatePositionEntity.z,
    eventType,
    estimatePositionEntity.id,
    team.nameUpper,
  );
  return true;
}

export function executeScriptTeamAvailableForRecruitment(self: GL, teamName: string, availability: boolean): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  team.recruitableOverride = availability;
  return true;
}

export function executeScriptTeamCollectNearbyForTeam(self: GL, _teamName: string): boolean {
  return true;
}

export function executeScriptTeamMergeIntoTeam(self: GL, sourceTeamName: string, targetTeamName: string): boolean {
  const sourceTeam = getScriptTeamRecord(self, sourceTeamName);
  const targetTeam = getScriptTeamRecord(self, targetTeamName);
  if (!sourceTeam || !targetTeam) {
    return false;
  }
  if (sourceTeam.nameUpper === targetTeam.nameUpper) {
    return true;
  }

  const mergedEntityIds = new Set<number>(targetTeam.memberEntityIds);
  const targetSide = resolveScriptTeamControllingSide(self, targetTeam);
  for (const entityId of sourceTeam.memberEntityIds) {
    mergedEntityIds.add(entityId);
    const entity = self.spawnedEntities.get(entityId);
    if (!entity || entity.destroyed || !targetSide) {
      continue;
    }
    self.transferScriptEntityToSide(entity, targetSide);
  }
  targetTeam.memberEntityIds = mergedEntityIds;
  targetTeam.created = true;
  if (targetTeam.recruitableOverride === null && sourceTeam.recruitableOverride !== null) {
    targetTeam.recruitableOverride = sourceTeam.recruitableOverride;
  }
  sourceTeam.memberEntityIds = new Set<number>();
  sourceTeam.created = false;
  self.scriptTeamCreatedReadyFrameByName.delete(sourceTeam.nameUpper);

  // Source parity bridge: Team::deleteTeam empties members but singleton teams persist.
  // Non-prototype synthetic instances are removed after transfer.
  if (sourceTeam.nameUpper !== sourceTeam.prototypeNameUpper) {
    if (!self.clearScriptTeam(sourceTeam.nameUpper)) {
      return false;
    }
  }

  return true;
}

export function executeScriptDamageMembersOfTeam(self: GL, teamName: string, amount: number): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }
  if (!Number.isFinite(amount)) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (isScriptEntityEffectivelyDead(self, entity)) {
      continue;
    }
    self.applyWeaponDamageAmount(null, entity, amount, 'UNRESISTABLE', 'NORMAL');
  }
  return true;
}

export function executeScriptMoveTeamToWaypoint(self: GL, teamName: string, waypointName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  if (!waypoint) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed || !entity.canMove) {
      continue;
    }
    self.cancelEntityCommandPathActions(entity.id);
    self.clearAttackTarget(entity.id);
    self.issueMoveTo(entity.id, waypoint.x, waypoint.z);
  }
  return true;
}

export function executeScriptMoveNamedUnitToWaypoint(self: GL, entityId: number, waypointName: string): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed || !entity.canMove) {
    return false;
  }
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  if (!waypoint) {
    return false;
  }

  self.cancelEntityCommandPathActions(entity.id);
  self.clearAttackTarget(entity.id);
  self.issueMoveTo(entity.id, waypoint.x, waypoint.z);
  return true;
}

export function resolveScriptChooseVictimDifficultyForEntity(self: GL, 
  entity: MapEntity,
  commandSource: AttackCommandSource,
): number {
  let difficulty = SCRIPT_DIFFICULTY_NORMAL;

  const entitySide = self.normalizeSide(entity.side);
  if (entitySide) {
    const sideIndex = self.mapScriptSideByIndex.findIndex((side) => side === entitySide);
    if (sideIndex >= 0) {
      difficulty = self.resolveMapScriptDifficultyForSide(sideIndex);
    }
  }

  if (commandSource === 'PLAYER') {
    difficulty = SCRIPT_DIFFICULTY_HARD;
  }

  if (self.scriptChooseVictimAlwaysUsesNormal) {
    difficulty = SCRIPT_DIFFICULTY_NORMAL;
  }

  return difficulty;
}

export function executeScriptTeamAttackTeam(self: GL, attackerTeamName: string, victimTeamName: string): boolean {
  const attackerTeam = getScriptTeamRecord(self, attackerTeamName);
  const victimTeam = getScriptTeamRecord(self, victimTeamName);
  if (!attackerTeam || !victimTeam) {
    return false;
  }

  const victims: MapEntity[] = [];
  for (const victim of getScriptTeamMemberEntities(self, victimTeam)) {
    if (victim.destroyed || isScriptEntityEffectivelyDead(self, victim)) {
      continue;
    }
    victims.push(victim);
  }

  if (victims.length === 0) {
    return true;
  }

  const attackers: MapEntity[] = [];
  for (const attacker of getScriptTeamMemberEntities(self, attackerTeam)) {
    if (attacker.destroyed || isScriptEntityEffectivelyDead(self, attacker)) {
      continue;
    }
    attackers.push(attacker);
  }

  for (const attacker of attackers) {
    let bestVictim: MapEntity | null = null;
    const difficulty = resolveScriptChooseVictimDifficultyForEntity(self, attacker, 'SCRIPT');
    if (difficulty === SCRIPT_DIFFICULTY_EASY) {
      const pick = self.gameRandom.nextRange(0, victims.length - 1);
      bestVictim = victims[pick] ?? null;
    } else if (difficulty === SCRIPT_DIFFICULTY_HARD) {
      bestVictim = victims[0] ?? null;
    } else {
      let bestDistSq = Number.POSITIVE_INFINITY;
      for (const victim of victims) {
        const dx = victim.x - attacker.x;
        const dz = victim.z - attacker.z;
        const distSq = (dx * dx) + (dz * dz);
        if (distSq < bestDistSq) {
          bestVictim = victim;
          bestDistSq = distSq;
        }
      }
    }
    if (!bestVictim) {
      continue;
    }
    self.cancelEntityCommandPathActions(attacker.id);
    self.issueAttackEntity(attacker.id, bestVictim.id, 'SCRIPT');
  }

  return true;
}

export function executeScriptNamedAttackNamed(self: GL, attackerEntityId: number, victimEntityId: number): boolean {
  const attacker = self.spawnedEntities.get(attackerEntityId);
  const victim = self.spawnedEntities.get(victimEntityId);
  if (!attacker || !victim || attacker.destroyed || victim.destroyed) {
    return false;
  }

  self.setEntityLocomotorSet(attacker.id, LOCOMOTORSET_NORMAL);
  self.cancelEntityCommandPathActions(attacker.id);
  self.issueAttackEntity(attacker.id, victim.id, 'SCRIPT');
  return true;
}

export function findScriptClosestEnemyInTriggerArea(self: GL, attacker: MapEntity, triggerIndex: number): MapEntity | null {
  const trigger = self.mapTriggerRegions[triggerIndex];
  if (!trigger) {
    return null;
  }

  let bestVictim: MapEntity | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const candidate of self.spawnedEntities.values()) {
    if (candidate.destroyed || candidate.id === attacker.id || !candidate.canTakeDamage) {
      continue;
    }
    if (!self.isPointInsideTriggerRegion(trigger, candidate.x, candidate.z)) {
      continue;
    }
    if (self.getTeamRelationship(attacker, candidate) !== RELATIONSHIP_ENEMIES) {
      continue;
    }
    if (
      candidate.objectStatusFlags.has('STEALTHED')
      && !candidate.objectStatusFlags.has('DETECTED')
    ) {
      continue;
    }
    if (!self.canAttackerTargetEntity(attacker, candidate, 'SCRIPT')) {
      continue;
    }

    const dx = candidate.x - attacker.x;
    const dz = candidate.z - attacker.z;
    const distanceSq = (dx * dx) + (dz * dz);
    if (distanceSq >= bestDistanceSq) {
      continue;
    }

    bestVictim = candidate;
    bestDistanceSq = distanceSq;
  }
  return bestVictim;
}

export function setScriptAttackAreaState(self: GL, entityId: number, triggerIndex: number): void {
  const firstScanDelay = self.gameRandom.nextRange(0, LOGIC_FRAME_RATE);
  self.scriptAttackAreaStateByEntityId.set(entityId, {
    triggerIndex,
    nextEnemyScanFrame: self.frameCounter + firstScanDelay,
  });
}

export function executeScriptNamedAttackArea(self: GL, attackerEntityId: number, triggerName: string): boolean {
  const attacker = self.spawnedEntities.get(attackerEntityId);
  const area = resolveScriptTriggerAreaByName(self, triggerName);
  if (!attacker || attacker.destroyed || !area) {
    return false;
  }

  self.setEntityLocomotorSet(attacker.id, LOCOMOTORSET_NORMAL);
  self.cancelEntityCommandPathActions(attacker.id);
  self.clearAttackTarget(attacker.id);
  setScriptAttackAreaState(self, attacker.id, area.triggerIndex);
  const attackAreaState = self.scriptAttackAreaStateByEntityId.get(attacker.id);
  if (attackAreaState) {
    self.updateScriptAttackAreaEntity(attacker, attackAreaState, true);
  }
  return true;
}

export function executeScriptNamedAttackTeam(self: GL, attackerEntityId: number, victimTeamName: string): boolean {
  const attacker = self.spawnedEntities.get(attackerEntityId);
  const victimTeam = getScriptTeamRecord(self, victimTeamName);
  if (!attacker || attacker.destroyed || !victimTeam) {
    return false;
  }

  const victims: MapEntity[] = [];
  for (const entity of getScriptTeamMemberEntities(self, victimTeam)) {
    if (entity.destroyed || isScriptEntityEffectivelyDead(self, entity)) {
      continue;
    }
    victims.push(entity);
  }

  self.setEntityLocomotorSet(attacker.id, LOCOMOTORSET_NORMAL);
  self.cancelEntityCommandPathActions(attacker.id);
  self.clearAttackTarget(attacker.id);
  if (victims.length === 0) {
    return true;
  }

  let bestVictim: MapEntity | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const victim of victims) {
    const dx = victim.x - attacker.x;
    const dz = victim.z - attacker.z;
    const distanceSq = (dx * dx) + (dz * dz);
    if (distanceSq < bestDistanceSq) {
      bestVictim = victim;
      bestDistanceSq = distanceSq;
    }
  }

  if (bestVictim) {
    self.issueAttackEntity(attacker.id, bestVictim.id, 'SCRIPT');
  }
  return true;
}

export function executeScriptTeamAttackArea(self: GL, attackerTeamName: string, triggerName: string): boolean {
  const attackerTeam = getScriptTeamRecord(self, attackerTeamName);
  const area = resolveScriptTriggerAreaByName(self, triggerName);
  if (!attackerTeam || !area) {
    return false;
  }

  for (const attacker of getScriptTeamMemberEntities(self, attackerTeam)) {
    if (attacker.destroyed || isScriptEntityEffectivelyDead(self, attacker)) {
      continue;
    }
    self.cancelEntityCommandPathActions(attacker.id);
    self.clearAttackTarget(attacker.id);
    setScriptAttackAreaState(self, attacker.id, area.triggerIndex);
    const attackAreaState = self.scriptAttackAreaStateByEntityId.get(attacker.id);
    if (attackAreaState) {
      self.updateScriptAttackAreaEntity(attacker, attackAreaState, true);
    }
  }

  return true;
}

export function executeScriptTeamAttackNamed(self: GL, attackerTeamName: string, victimEntityId: number): boolean {
  const attackerTeam = getScriptTeamRecord(self, attackerTeamName);
  const victim = self.spawnedEntities.get(victimEntityId);
  if (!attackerTeam || !victim || victim.destroyed) {
    return false;
  }

  for (const attacker of getScriptTeamMemberEntities(self, attackerTeam)) {
    if (attacker.destroyed || isScriptEntityEffectivelyDead(self, attacker)) {
      continue;
    }
    self.cancelEntityCommandPathActions(attacker.id);
    self.clearAttackTarget(attacker.id);
    self.issueAttackEntity(attacker.id, victim.id, 'SCRIPT');
  }

  return true;
}

export function resolveScriptEntityTransportSlotCount(self: GL, entity: MapEntity): number {
  return resolveScriptEntityTransportSlotCountRecursive(self, entity, new Set<number>());
}

export function resolveScriptEntityTransportSlotCountRecursive(self: GL, entity: MapEntity, visitedEntityIds: Set<number>): number {
  if (visitedEntityIds.has(entity.id)) {
    return 0;
  }
  visitedEntityIds.add(entity.id);

  // Source parity: Object::getTransportSlotCount — special zero-slot containers
  // proxy slot count to their contained riders.
  if (entity.containProfile?.moduleType === 'PARACHUTE') {
    let totalSlots = 0;
    for (const containedEntityId of self.collectContainedEntityIds(entity.id)) {
      const containedEntity = self.spawnedEntities.get(containedEntityId);
      if (!containedEntity || containedEntity.destroyed) {
        continue;
      }
      totalSlots += resolveScriptEntityTransportSlotCountRecursive(self, containedEntity, visitedEntityIds);
    }
    return totalSlots;
  }

  return resolveScriptEntityRawTransportSlotCount(self, entity);
}

export function resolveScriptEntityRawTransportSlotCount(self: GL, entity: MapEntity): number {
  const registry = self.iniDataRegistry;
  if (registry) {
    const objectDef = findObjectDefByName(registry, entity.templateName);
    if (objectDef) {
      const configuredSlotCount = readNumericField(objectDef.fields, ['TransportSlotCount']);
      if (configuredSlotCount !== null && Number.isFinite(configuredSlotCount)) {
        return Math.max(0, Math.trunc(configuredSlotCount));
      }
    }
  }
  // Source parity: ThingTemplate ctor defaults m_transportSlotCount = 0.
  return 0;
}

export function resolveScriptTransportValidationEntity(self: GL, entity: MapEntity): MapEntity {
  if (entity.containProfile?.moduleType !== 'PARACHUTE') {
    return entity;
  }
  for (const containedEntityId of self.collectContainedEntityIds(entity.id)) {
    const containedEntity = self.spawnedEntities.get(containedEntityId);
    if (containedEntity && !containedEntity.destroyed) {
      return containedEntity;
    }
  }
  return entity;
}

export function isScriptContainKindAllowed(self: GL, container: MapEntity, rider: MapEntity): boolean {
  const containProfile = container.containProfile;
  if (!containProfile) {
    return false;
  }

  const riderKinds = self.resolveEntityKindOfSet(rider);
  const allowInsideKindOf = containProfile.allowInsideKindOf;
  if (allowInsideKindOf && allowInsideKindOf.size > 0) {
    let hasAllowedKind = false;
    for (const kindOfName of allowInsideKindOf) {
      if (riderKinds.has(kindOfName)) {
        hasAllowedKind = true;
        break;
      }
    }
    if (!hasAllowedKind) {
      return false;
    }
  }

  for (const kindOfName of containProfile.forbidInsideKindOf) {
    if (riderKinds.has(kindOfName)) {
      return false;
    }
  }

  return true;
}

export function isScriptContainRelationshipAllowed(self: GL, container: MapEntity, rider: MapEntity): boolean {
  const containProfile = container.containProfile;
  if (!containProfile) {
    return false;
  }

  const relationship = self.getTeamRelationship(rider, container);
  switch (relationship) {
    case RELATIONSHIP_ALLIES:
      return containProfile.allowAlliesInside;
    case RELATIONSHIP_ENEMIES:
      return containProfile.allowEnemiesInside;
    case RELATIONSHIP_NEUTRAL:
      return containProfile.allowNeutralInside;
    default:
      return false;
  }
}

export function resolveScriptContainerUsedTransportSlots(self: GL, container: MapEntity): number {
  let usedSlots = 0;
  for (const containedEntityId of self.collectContainedEntityIds(container.id)) {
    const containedEntity = self.spawnedEntities.get(containedEntityId);
    if (!containedEntity || containedEntity.destroyed) {
      continue;
    }
    usedSlots += resolveScriptEntityTransportSlotCount(self, containedEntity);
  }
  return usedSlots;
}

export function executeScriptTeamLoadTransports(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const entries: Array<{ entityId: number; size: number }> = [];
  const spaces: Array<{ entityId: number; capacity: number }> = [];
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    if (entity.kindOf.has('TRANSPORT')) {
      if (!entity.containProfile) {
        continue;
      }
      spaces.push({
        entityId: entity.id,
        capacity: Math.max(0, resolveScriptContainerCapacity(self, entity)),
      });
    } else {
      entries.push({
        entityId: entity.id,
        size: resolveScriptEntityTransportSlotCount(self, entity),
      });
    }
  }

  if (entries.length === 0 || spaces.length === 0) {
    return true;
  }

  const assignments = self.solveScriptFastPartitionAssignments(entries, spaces);
  for (const assignment of assignments) {
    const unit = self.spawnedEntities.get(assignment.entryEntityId);
    const transport = self.spawnedEntities.get(assignment.spaceEntityId);
    if (!unit || !transport || unit.destroyed || transport.destroyed) {
      continue;
    }
    // Source parity: ScriptActions::doLoadAllTransports chooses LOCOMOTORSET_NORMAL
    // for each assigned unit before issuing aiEnter.
    self.setEntityLocomotorSet(unit.id, LOCOMOTORSET_NORMAL);
    self.applyCommand({
      type: 'enterTransport',
      entityId: unit.id,
      targetTransportId: transport.id,
      commandSource: 'SCRIPT',
    });
  }
  return true;
}

export function setScriptHuntState(self: GL, entityId: number): void {
  self.scriptHuntStateByEntityId.set(entityId, {
    nextEnemyScanFrame: self.frameCounter,
  });
}

export function findScriptHuntTarget(self: GL, entity: MapEntity): MapEntity | null {
  let bestTarget: MapEntity | null = null;
  let bestDistanceSqr = Number.POSITIVE_INFINITY;

  for (const candidate of self.spawnedEntities.values()) {
    if (candidate.destroyed || candidate.id === entity.id || !candidate.canTakeDamage) {
      continue;
    }
    if (self.getTeamRelationship(entity, candidate) !== RELATIONSHIP_ENEMIES) {
      continue;
    }
    if (
      candidate.objectStatusFlags.has('STEALTHED')
      && !candidate.objectStatusFlags.has('DETECTED')
    ) {
      continue;
    }
    if (!self.canAttackerTargetEntity(entity, candidate, 'SCRIPT')) {
      continue;
    }

    const dx = candidate.x - entity.x;
    const dz = candidate.z - entity.z;
    const distanceSqr = dx * dx + dz * dz;
    if (distanceSqr >= bestDistanceSqr) {
      continue;
    }
    bestDistanceSqr = distanceSqr;
    bestTarget = candidate;
  }

  return bestTarget;
}

export function executeScriptNamedHunt(self: GL, entityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed || isScriptEntityEffectivelyDead(self, entity)) {
    return false;
  }
  if (!entity.canMove || entity.kindOf.has('PROJECTILE')) {
    return false;
  }

  self.setEntityLocomotorSet(entity.id, LOCOMOTORSET_NORMAL);
  self.clearCommandButtonHuntForEntity(entity);
  self.applyCommand({ type: 'stop', entityId: entity.id, commandSource: 'AI' });
  setScriptHuntState(self, entity.id);
  entity.autoTargetScanNextFrame = self.frameCounter;
  return true;
}

export function executeScriptTeamHunt(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    executeScriptNamedHunt(self, entity.id);
  }
  return true;
}

export function executeScriptPlayerHunt(self: GL, side: string): boolean {
  const normalizedSide = self.normalizeSide(side);
  if (!normalizedSide) {
    return false;
  }
  if (!collectScriptKnownSides(self).has(normalizedSide)) {
    return false;
  }

  self.scriptSidesUnitsShouldHunt.add(normalizedSide);

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || self.normalizeSide(entity.side) !== normalizedSide) {
      continue;
    }
    if (isScriptEntityEffectivelyDead(self, entity) && !self.isBeaconEntity(entity)) {
      continue;
    }

    const disqualifyingKindOf = self.resolveEntityKindOfSet(entity);
    if (
      disqualifyingKindOf.has('DOZER')
      || disqualifyingKindOf.has('HARVESTER')
      || disqualifyingKindOf.has('IGNORES_SELECT_ALL')
    ) {
      continue;
    }

    executeScriptNamedHunt(self, entity.id);
  }
  return true;
}

export function executeScriptPlayerSellEverything(self: GL, side: string): boolean {
  const normalizedSide = self.normalizeSide(side);
  if (!normalizedSide) {
    return false;
  }
  if (!collectScriptKnownSides(self).has(normalizedSide)) {
    return false;
  }

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || self.normalizeSide(entity.side) !== normalizedSide) {
      continue;
    }
    // Source parity: Player.cpp:2311-2317 — sellBuildings only sells faction structures
    // (STRUCTURE + any FS_* kindOf), COMMANDCENTER, or FS_POWER entities.
    // In Generals, all structures were sold indiscriminately; ZH restricts this.
    if (!self.isFactionStructure(entity)
      && !entity.kindOf.has('COMMANDCENTER')
      && !entity.kindOf.has('FS_POWER')) {
      continue;
    }
    self.applyCommand({ type: 'sell', entityId: entity.id });
  }
  return true;
}

export function executeScriptPlayerSetBaseConstructionEnabled(self: GL, side: string, enabled: boolean): boolean {
  const normalizedSide = self.normalizeSide(side);
  if (!normalizedSide) {
    return false;
  }
  if (!collectScriptKnownSides(self).has(normalizedSide)) {
    return false;
  }
  self.sideCanBuildBaseByScript.set(normalizedSide, enabled);
  return true;
}

export function executeScriptPlayerSetUnitConstructionEnabled(self: GL, side: string, enabled: boolean): boolean {
  const normalizedSide = self.normalizeSide(side);
  if (!normalizedSide) {
    return false;
  }
  if (!collectScriptKnownSides(self).has(normalizedSide)) {
    return false;
  }
  self.sideCanBuildUnitsByScript.set(normalizedSide, enabled);
  return true;
}

export function executeScriptPlayerSetObjectTemplateEnabled(self: GL, 
  side: string,
  templateName: string,
  enabled: boolean,
): boolean {
  const normalizedSide = self.normalizeSide(side);
  if (!normalizedSide) {
    return false;
  }
  if (!collectScriptKnownSides(self).has(normalizedSide)) {
    return false;
  }
  const normalizedTemplateName = templateName.trim().toUpperCase();
  if (!normalizedTemplateName) {
    return false;
  }

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || self.normalizeSide(entity.side) !== normalizedSide) {
      continue;
    }
    if (entity.templateName.trim().toUpperCase() !== normalizedTemplateName) {
      continue;
    }
    if (enabled) {
      entity.objectStatusFlags.delete('SCRIPT_DISABLED');
    } else {
      entity.objectStatusFlags.add('SCRIPT_DISABLED');
    }
  }

  return true;
}

export function normalizeScriptAttackPrioritySetName(self: GL, attackPrioritySetName: string): string {
  return attackPrioritySetName.trim().toUpperCase();
}

export function resolveScriptAttackPrioritySetNameForApply(self: GL, attackPrioritySetName: string): string {
  const normalizedSetName = normalizeScriptAttackPrioritySetName(self, attackPrioritySetName);
  if (!normalizedSetName) {
    return '';
  }
  return self.scriptAttackPrioritySetsByName.has(normalizedSetName)
    ? normalizedSetName
    : '';
}

export function executeScriptSetAttackPriorityThing(self: GL, 
  attackPrioritySetName: string,
  objectTypeName: string,
  priority: number,
): boolean {
  const info = self.getOrCreateScriptAttackPrioritySetRecord(attackPrioritySetName);
  if (!info) {
    return false;
  }

  const objectTypes = resolveScriptObjectTypeCandidatesForAction(self, objectTypeName);
  if (!objectTypes || objectTypes.length === 0) {
    return false;
  }

  const nextPriority = Math.trunc(priority);
  for (const objectType of objectTypes) {
    const normalizedObjectType = normalizeScriptObjectTypeName(self, objectType);
    if (!normalizedObjectType || !self.resolveObjectDefByTemplateName(normalizedObjectType)) {
      return false;
    }
    info.templatePriorityByName.set(normalizedObjectType, nextPriority);
  }
  return true;
}

export function executeScriptSetAttackPriorityKindOf(self: GL, 
  attackPrioritySetName: string,
  kindOfBit: number,
  priority: number,
): boolean {
  const info = self.getOrCreateScriptAttackPrioritySetRecord(attackPrioritySetName);
  if (!info) {
    return false;
  }

  const kindOfName = resolveScriptKindOfNameFromSourceBit(self, kindOfBit);
  if (!kindOfName) {
    return true;
  }

  const registry = self.iniDataRegistry;
  if (!registry) {
    return false;
  }

  const nextPriority = Math.trunc(priority);
  for (const objectDef of registry.objects.values()) {
    if (!self.normalizeKindOf(objectDef.kindOf).has(kindOfName)) {
      continue;
    }
    const normalizedTemplateName = normalizeScriptObjectTypeName(self, objectDef.name);
    if (!normalizedTemplateName) {
      continue;
    }
    info.templatePriorityByName.set(normalizedTemplateName, nextPriority);
  }
  return true;
}

export function executeScriptSetDefaultAttackPriority(self: GL, 
  attackPrioritySetName: string,
  defaultPriority: number,
): boolean {
  const info = self.getOrCreateScriptAttackPrioritySetRecord(attackPrioritySetName);
  if (!info) {
    return false;
  }
  info.defaultPriority = Math.trunc(defaultPriority);
  return true;
}

export function executeScriptNamedApplyAttackPrioritySet(self: GL, entityId: number, attackPrioritySetName: string): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  entity.scriptAttackPrioritySetName = resolveScriptAttackPrioritySetNameForApply(self, attackPrioritySetName);
  return true;
}

export function executeScriptTeamApplyAttackPrioritySet(self: GL, teamName: string, attackPrioritySetName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const normalizedSetName = resolveScriptAttackPrioritySetNameForApply(self, attackPrioritySetName);
  if (normalizedSetName) {
    team.attackPrioritySetName = normalizedSetName;
  }
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    entity.scriptAttackPrioritySetName = normalizedSetName;
  }

  return true;
}

export function executeScriptSetBaseConstructionSpeed(self: GL, side: string, delayInSeconds: number): boolean {
  const normalizedSide = self.normalizeSide(side);
  if (!normalizedSide) {
    return false;
  }
  if (!collectScriptKnownSides(self).has(normalizedSide)) {
    return false;
  }
  self.sideTeamBuildDelaySecondsByScript.set(normalizedSide, Math.trunc(delayInSeconds));
  return true;
}

export function executeScriptNamedSetAttitude(self: GL, entityId: number, attitude: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  entity.scriptAttitude = Math.trunc(attitude);
  return true;
}

export function executeScriptTeamSetAttitude(self: GL, teamName: string, attitude: number): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }
  const nextAttitude = Math.trunc(attitude);
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    entity.scriptAttitude = nextAttitude;
  }
  return true;
}

export function executeScriptCreateObjectAtPosition(self: GL, 
  templateName: string,
  teamName: string,
  position: unknown,
  angleRadians: number,
): boolean {
  const coord3 = coerceScriptConditionCoord3(self, position);
  if (!coord3) {
    return false;
  }
  return executeScriptCreateObject(self, 
    '',
    templateName,
    teamName,
    coord3.x,
    coord3.y,
    angleRadians,
    coord3.z,
  );
}

export function executeScriptCreateNamedObjectAtPosition(self: GL, 
  objectName: string,
  templateName: string,
  teamName: string,
  position: unknown,
  angleRadians: number,
): boolean {
  const coord3 = coerceScriptConditionCoord3(self, position);
  if (!coord3) {
    return false;
  }
  return executeScriptCreateObject(self, 
    objectName,
    templateName,
    teamName,
    coord3.x,
    coord3.y,
    angleRadians,
    coord3.z,
  );
}

export function executeScriptCreateUnitOnTeamAtWaypoint(self: GL, 
  objectName: string,
  templateName: string,
  teamName: string,
  waypointName: string,
): boolean {
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  if (!waypoint) {
    return false;
  }
  return executeScriptCreateObject(self, 
    objectName,
    templateName,
    teamName,
    waypoint.x,
    waypoint.z,
    0,
  );
}

export function executeScriptCreateObject(self: GL, 
  objectName: string,
  templateName: string,
  teamName: string,
  worldX: number,
  worldZ: number,
  angleRadians: number,
  worldY?: number,
): boolean {
  const normalizedTemplateName = templateName.trim();
  if (!normalizedTemplateName) {
    return false;
  }
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ) || !Number.isFinite(angleRadians)) {
    return false;
  }

  const team = getScriptTeamRecord(self, teamName) ?? self.getOrCreateScriptTeamRecord(teamName);
  if (!team) {
    return false;
  }

  const normalizedObjectName = normalizeScriptObjectName(self, objectName);
  const hasObjectName = normalizedObjectName.length > 0;
  if (hasObjectName) {
    const existingNamedEntity = resolveScriptNamedEntityByName(self, normalizedObjectName);
    if (existingNamedEntity && !isScriptEntityEffectivelyDead(self, existingNamedEntity)) {
      return false;
    }
  }

  const teamSide = resolveScriptTeamControllingSide(self, team);
  const created = self.spawnEntityFromTemplate(
    normalizedTemplateName,
    worldX,
    worldZ,
    angleRadians,
    teamSide || undefined,
  );
  if (!created) {
    return false;
  }

  if (hasObjectName) {
    self.transferScriptObjectName(normalizedObjectName, created);
  }
  if (worldY !== undefined && Number.isFinite(worldY)) {
    created.y = worldY + created.baseHeight;
  }
  if (created.kindOf.has('BLAST_CRATER')) {
    self.createCraterInTerrain(created);
    // Source parity (GeneralsMD): ScriptActions::doCreateObject adds blast
    // crater footprint to pathfind map immediately after terrain deformation.
    self.refreshNavigationGridFromCurrentMap();
  }

  team.memberEntityIds.add(created.id);
  team.created = true;
  if (!team.controllingSide) {
    const createdSide = self.normalizeSide(created.side);
    if (createdSide) {
      team.controllingSide = createdSide;
      if (!team.controllingPlayerToken) {
        team.controllingPlayerToken = self.normalizeControllingPlayerToken(createdSide);
      }
    }
  }
  return true;
}

export function resolveScriptNamedEntityByName(self: GL, objectName: string): MapEntity | null {
  const normalizedObjectName = normalizeScriptObjectName(self, objectName);
  if (!normalizedObjectName) {
    return null;
  }
  const mappedId = self.scriptNamedEntitiesByName.get(normalizedObjectName);
  if (mappedId === undefined) {
    return null;
  }
  const entity = self.spawnedEntities.get(mappedId);
  if (!entity || entity.scriptName !== normalizedObjectName) {
    return null;
  }
  return entity;
}

export function executeScriptTeamStopAndDisband(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }
  return executeScriptSingleTeamStopAndDisband(self, team);
}

export function executeScriptSingleTeamStopAndDisband(self: GL, team: ScriptTeamRecord): boolean {
  const stopped = executeScriptTeamStop(self, team.nameUpper);
  if (!stopped) {
    return false;
  }

  // Source parity: ScriptActions::doTeamStop(team, TRUE) marks each member
  // recruitable before merging into the controlling player's default team.
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (entity.destroyed) {
      continue;
    }
    entity.scriptAiRecruitable = true;
  }

  // Source parity bridge: doTeamStop(team, TRUE) marks members recruitable before merge.
  team.recruitableOverride = true;

  const controllingSide = resolveScriptTeamControllingSide(self, team);
  if (controllingSide) {
    const defaultTeamNameUpper = self.scriptDefaultTeamNameBySide.get(controllingSide) ?? null;
    // Source parity bridge: when disband is requested on the controlling side's
    // default team, keep default-team bookkeeping intact.
    if (defaultTeamNameUpper && defaultTeamNameUpper === team.nameUpper) {
      return true;
    }
    if (defaultTeamNameUpper && defaultTeamNameUpper !== team.nameUpper) {
      if (executeScriptTeamMergeIntoTeam(self, team.nameUpper, defaultTeamNameUpper)) {
        return true;
      }
    }
  }

  return self.clearScriptTeam(team.nameUpper);
}

export function executeScriptBuildTeam(self: GL, teamName: string): boolean {
  const prototype = getScriptTeamPrototypeRecord(self, teamName);
  if (!prototype) {
    return false;
  }
  const team = resolveScriptTeamBuildOrRecruitTarget(self, prototype);
  if (team) {
    self.scheduleScriptTeamCreatedByConfiguredDelay(team);
  }
  return true;
}

export function executeScriptRecruitTeam(self: GL, teamName: string, _recruitRadius: number): boolean {
  const prototype = getScriptTeamPrototypeRecord(self, teamName);
  if (!prototype) {
    return false;
  }

  // Source parity: singleton teams with live members cannot be recruited again.
  // Keep existing created-pulse behavior for templates that don't define recruit entries.
  const hasRecruitEntries = prototype.reinforcementUnitEntries.length > 0;
  if (hasRecruitEntries && isScriptTeamPrototypeSingleton(self, prototype)) {
    const singletonTeam = getScriptTeamRecord(self, prototype.nameUpper);
    if (singletonTeam && getScriptTeamMemberEntities(self, singletonTeam)
      .some((entity) => isScriptTeamMemberAliveForObjects(self, entity))) {
      return true;
    }
  }

  const team = resolveScriptTeamBuildOrRecruitTarget(self, prototype);
  if (team) {
    executeScriptRecruitUnitsIntoTeam(self, team, prototype, _recruitRadius);
    self.scheduleScriptTeamCreatedByConfiguredDelay(team);
  }
  return true;
}

export function executeScriptRecruitUnitsIntoTeam(self: GL, 
  targetTeam: ScriptTeamRecord,
  prototype: ScriptTeamRecord,
  recruitRadius: number,
): number {
  const controllingSide = resolveScriptTeamControllingSide(self, targetTeam)
    ?? resolveScriptTeamControllingSide(self, prototype);
  if (!controllingSide) {
    return 0;
  }
  const home = resolveScriptTeamRecruitHomePosition(self, prototype);
  const maxDistance = recruitRadius < 1 ? 99999 : recruitRadius;

  let recruited = 0;
  for (const unitEntry of prototype.reinforcementUnitEntries) {
    let remaining = unitEntry.maxUnits;
    while (remaining > 0) {
      const candidate = findScriptTeamRecruitCandidate(self, 
        targetTeam,
        unitEntry.templateName,
        controllingSide,
        home.x,
        home.z,
        maxDistance,
      );
      if (!candidate) {
        break;
      }
      if (candidate.sourceTeam.nameUpper !== targetTeam.nameUpper) {
        candidate.sourceTeam.memberEntityIds.delete(candidate.entity.id);
      }
      targetTeam.memberEntityIds.add(candidate.entity.id);
      if (candidate.entity.canMove && !self.entityHasObjectStatus(candidate.entity, 'DISABLED_HELD')) {
        self.issueMoveTo(candidate.entity.id, home.x, home.z);
      }
      recruited += 1;
      remaining -= 1;
    }
  }

  return recruited;
}

export function resolveScriptTeamRecruitHomePosition(self: GL, team: ScriptTeamRecord): { x: number; z: number } {
  const waypointName = team.homeWaypointName.trim();
  if (!waypointName) {
    return { x: 0, z: 0 };
  }
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  if (!waypoint) {
    return { x: 0, z: 0 };
  }
  return waypoint;
}

export function isScriptTeamRecruitSourceActive(self: GL, team: ScriptTeamRecord): boolean {
  return team.created || team.memberEntityIds.size > 0;
}

export function isScriptTeamRecruitSourceEligible(self: GL, 
  sourceTeam: ScriptTeamRecord,
  targetTeam: ScriptTeamRecord,
  controllingSide: string,
): boolean {
  if (!isScriptTeamRecruitSourceActive(self, sourceTeam)) {
    return false;
  }
  const sourceControllingSide = resolveScriptTeamControllingSide(self, sourceTeam);
  if (!sourceControllingSide || sourceControllingSide !== controllingSide) {
    return false;
  }
  if (sourceTeam.productionPriority >= targetTeam.productionPriority) {
    return false;
  }

  const defaultTeamNameUpper = self.scriptDefaultTeamNameBySide.get(controllingSide) ?? '';
  let teamIsRecruitable = sourceTeam.nameUpper === defaultTeamNameUpper;
  if (sourceTeam.isAIRecruitable) {
    teamIsRecruitable = true;
  }
  if (sourceTeam.recruitableOverride !== null) {
    teamIsRecruitable = sourceTeam.recruitableOverride;
  }
  return teamIsRecruitable;
}

export function findScriptTeamRecruitCandidate(self: GL, 
  targetTeam: ScriptTeamRecord,
  templateName: string,
  controllingSide: string,
  homeX: number,
  homeZ: number,
  maxDistance: number,
): { entity: MapEntity; sourceTeam: ScriptTeamRecord } | null {
  const maxDistanceSqr = maxDistance * maxDistance;
  let bestEntity: MapEntity | null = null;
  let bestSourceTeam: ScriptTeamRecord | null = null;
  let bestDistSqr = maxDistanceSqr;

  for (const sourceTeam of self.scriptTeamsByName.values()) {
    if (!isScriptTeamRecruitSourceEligible(self, sourceTeam, targetTeam, controllingSide)) {
      continue;
    }
    const isDefaultTeam = sourceTeam.nameUpper === (self.scriptDefaultTeamNameBySide.get(controllingSide) ?? '');

    for (const entity of getScriptTeamMemberEntities(self, sourceTeam)) {
      if (entity.destroyed || isScriptEntityEffectivelyDead(self, entity)) {
        continue;
      }
      if (self.normalizeSide(entity.side) !== controllingSide) {
        continue;
      }
      if (!self.areEquivalentTemplateNames(entity.templateName, templateName)) {
        continue;
      }
      if (!entity.scriptAiRecruitable) {
        continue;
      }
      if (entity.objectStatusFlags.has('DISABLED_HELD')) {
        continue;
      }

      const dx = homeX - entity.x;
      const dz = homeZ - entity.z;
      const distSqr = dx * dx + dz * dz;
      if (distSqr > maxDistanceSqr) {
        continue;
      }

      if (!bestEntity && isDefaultTeam) {
        bestEntity = entity;
        bestSourceTeam = sourceTeam;
        bestDistSqr = distSqr;
        continue;
      }

      if (distSqr <= bestDistSqr) {
        bestEntity = entity;
        bestSourceTeam = sourceTeam;
        bestDistSqr = distSqr;
      }
    }
  }

  if (!bestEntity || !bestSourceTeam) {
    return null;
  }
  return { entity: bestEntity, sourceTeam: bestSourceTeam };
}

export function executeScriptCreateReinforcementTeam(self: GL, teamName: string, waypointName: string): boolean {
  const prototype = getScriptTeamPrototypeRecord(self, teamName);
  if (!prototype) {
    return false;
  }
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  if (!waypoint) {
    return false;
  }

  const team = resolveScriptTeamBuildOrRecruitTarget(self, prototype);
  if (!team) {
    // Source parity: respect instance-cap behavior without failing script execution.
    return true;
  }

  self.scheduleScriptTeamCreatedByConfiguredDelay(team);
  materializeScriptReinforcementMembers(self, prototype, team, waypoint);
  return true;
}

export function materializeScriptReinforcementMembers(self: GL, 
  prototype: ScriptTeamRecord,
  team: ScriptTeamRecord,
  destination: { x: number; z: number },
): void {
  const controllingSide = resolveScriptTeamControllingSide(self, team) ?? prototype.controllingSide ?? undefined;
  let originX = destination.x;
  let originZ = destination.z;
  let needToMoveToDestination = false;

  const reinforceOriginName = prototype.reinforcementStartWaypointName.trim();
  if (reinforceOriginName) {
    const reinforceOrigin = resolveScriptWaypointPosition(self, reinforceOriginName);
    if (reinforceOrigin) {
      originX = reinforceOrigin.x;
      originZ = reinforceOrigin.z;
      if (originX !== destination.x || originZ !== destination.z) {
        needToMoveToDestination = true;
      }
    }
  }

  const transportTemplateName = prototype.reinforcementTransportTemplateName.trim();
  const transportTemplateUpper = transportTemplateName.toUpperCase();
  let primaryTransport: MapEntity | null = null;

  if (transportTemplateName) {
    const spawnedTransport = self.spawnEntityFromTemplate(
      transportTemplateName,
      originX,
      originZ,
      0,
      controllingSide,
    );
    if (spawnedTransport) {
      self.positionEntityAtWorldXZ(spawnedTransport, originX, originZ);
      team.memberEntityIds.add(spawnedTransport.id);
      primaryTransport = spawnedTransport;
    }
  }

  for (const unitEntry of prototype.reinforcementUnitEntries) {
    let lastSpawnedUnit: MapEntity | null = null;
    for (let unitIndex = 0; unitIndex < unitEntry.maxUnits; unitIndex += 1) {
      const spawnedUnit = self.spawnEntityFromTemplate(
        unitEntry.templateName,
        originX,
        originZ,
        0,
        controllingSide,
      );
      if (!spawnedUnit) {
        continue;
      }
      const xOffset = 2.25 * unitIndex * Math.max(spawnedUnit.geometryMajorRadius, MAP_XY_FACTOR * 0.5);
      self.positionEntityAtWorldXZ(spawnedUnit, originX + xOffset, originZ);
      team.memberEntityIds.add(spawnedUnit.id);
      lastSpawnedUnit = spawnedUnit;
    }

    if (lastSpawnedUnit) {
      // Source parity: C++ increments origin.y by 2 * majorRadius between unit type rows.
      // In this port Y is vertical, so we advance on world Z (engine horizontal Y).
      originZ += 2 * Math.max(lastSpawnedUnit.geometryMajorRadius, MAP_XY_FACTOR * 0.5);
    }
  }

  if (!team.controllingSide && controllingSide) {
    team.controllingSide = controllingSide;
    if (!team.controllingPlayerToken) {
      team.controllingPlayerToken = self.normalizeControllingPlayerToken(controllingSide);
    }
  }

  if (primaryTransport && prototype.reinforcementTeamStartsFull) {
    self.loadScriptReinforcementTeamIntoExistingTransports(team, primaryTransport.id);
  }

  if (primaryTransport) {
    self.loadScriptReinforcementMembersIntoTransportTemplate(
      team,
      primaryTransport,
      transportTemplateUpper,
      controllingSide,
      originX,
      originZ,
    );
  }

  if (primaryTransport) {
    const transportObjectDef = self.resolveObjectDefByTemplateName(primaryTransport.templateName);
    const transportDeliverPayloadProfile = resolveScriptReinforcementDeliverPayloadProfile(self, transportObjectDef);
    const transportUsesDeliverPayload = transportDeliverPayloadProfile !== null;
    for (const member of getScriptTeamMemberEntities(self, team)) {
      if (member.destroyed) {
        continue;
      }
      if (member.templateName.trim().toUpperCase() === transportTemplateUpper) {
        self.issueMoveTo(member.id, destination.x, destination.z, NO_ATTACK_DISTANCE, true);
        self.pendingScriptReinforcementTransportArrivalByEntityId.set(member.id, {
          targetX: destination.x,
          targetZ: destination.z,
          originX: member.x,
          originZ: member.z,
          deliveryDistance: transportDeliverPayloadProfile?.deliveryDistance ?? 0,
          deliverPayloadMode: transportUsesDeliverPayload,
          deliverPayloadDoorDelayFrames: transportDeliverPayloadProfile?.doorDelayFrames ?? 0,
          deliverPayloadDropDelayFrames: transportDeliverPayloadProfile?.dropDelayFrames ?? 0,
          deliverPayloadNextDropFrame: -1,
          deliverPayloadDropOffsetX: transportDeliverPayloadProfile?.dropOffsetX ?? 0,
          deliverPayloadDropOffsetZ: transportDeliverPayloadProfile?.dropOffsetZ ?? 0,
          deliverPayloadDropVarianceX: transportDeliverPayloadProfile?.dropVarianceX ?? 0,
          deliverPayloadDropVarianceZ: transportDeliverPayloadProfile?.dropVarianceZ ?? 0,
          exitTargetX: Number.NaN,
          exitTargetZ: Number.NaN,
          // Source parity: ScriptActions::doCreateReinforcements always routes
          // DeliverPayloadAIUpdate transports through deliverPayloadViaModuleData(),
          // which exits/deletes regardless of TeamTemplate::m_transportsExit.
          transportsExit: transportUsesDeliverPayload || prototype.reinforcementTransportsExit,
          evacuationIssued: false,
          exitMoveIssued: false,
        });
        continue;
      }
      if (self.isEntityContained(member)) {
        continue;
      }
      if (!member.objectStatusFlags.has('DISABLED_HELD') && member.canMove) {
        self.issueMoveTo(member.id, destination.x, destination.z, NO_ATTACK_DISTANCE, true);
      }
    }
    return;
  }

  if (!needToMoveToDestination) {
    return;
  }

  for (const member of getScriptTeamMemberEntities(self, team)) {
    if (member.destroyed || self.isEntityContained(member) || !member.canMove) {
      continue;
    }
    self.issueMoveTo(member.id, destination.x, destination.z, NO_ATTACK_DISTANCE, true);
  }
}

export function isScriptReinforcementTransportValidForUnit(self: GL, transport: MapEntity, unit: MapEntity): boolean {
  const containProfile = transport.containProfile;
  if (!containProfile) {
    return false;
  }
  const validationUnit = resolveScriptTransportValidationEntity(self, unit);
  const transportSide = self.normalizeSide(transport.side);
  const unitSide = self.normalizeSide(validationUnit.side);
  if (transportSide && unitSide && transportSide !== unitSide) {
    return false;
  }
  if (!isScriptContainRelationshipAllowed(self, transport, validationUnit)) {
    return false;
  }
  if (!isScriptContainKindAllowed(self, transport, validationUnit)) {
    return false;
  }

  const unitKindOf = self.resolveEntityKindOfSet(validationUnit);
  switch (containProfile.moduleType) {
    case 'TRANSPORT':
      return (unitKindOf.has('INFANTRY') || unitKindOf.has('VEHICLE'))
        && resolveScriptEntityTransportSlotCount(self, unit) > 0;
    case 'OVERLORD':
    case 'HELIX':
      return (unitKindOf.has('INFANTRY') || unitKindOf.has('PORTABLE_STRUCTURE'))
        && resolveScriptEntityTransportSlotCount(self, unit) > 0;
    case 'OPEN':
    case 'HEAL':
    case 'INTERNET_HACK':
      return true;
    default:
      return false;
  }
}

export function resolveScriptReinforcementDeliverPayloadProfile(self: GL, objectDef: ObjectDef | null):
{
  putInContainerTemplateName: string | null;
  deliveryDistance: number;
  doorDelayFrames: number;
  dropDelayFrames: number;
  dropOffsetX: number;
  dropOffsetZ: number;
  dropVarianceX: number;
  dropVarianceZ: number;
  /** Source parity: DeliverPayloadData::m_exitPitchRate — rad/frame (C++ parseAngularVelocityReal). */
  exitPitchRate: number;
  /** Source parity: DeliverPayloadData::m_isParachuteDirectly — parachute without transport landing (C++ parseBool). */
  parachuteDirectly: boolean;
  /** Source parity: DeliverPayloadData::m_maxAttempts — max delivery attempts (C++ parseInt, default 1). */
  maxAttempts: number;
  /** Source parity: DeliverPayloadData::m_diveStartDistance — distance to begin dive approach (C++ parseReal). */
  diveStartDistance: number;
} | null {
  if (!objectDef) {
    return null;
  }
  for (const block of objectDef.blocks) {
    if (block.type.toUpperCase() !== 'BEHAVIOR') {
      continue;
    }
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'DELIVERPAYLOADAIUPDATE') {
      continue;
    }
    const putInContainerTemplateName = readStringField(block.fields, ['PutInContainer'])?.trim() ?? '';
    const deliveryDistance = Math.max(0, readNumericField(block.fields, ['DeliveryDistance']) ?? 0);
    const doorDelayMs = Math.max(0, readNumericField(block.fields, ['DoorDelay']) ?? 0);
    const dropDelayMs = Math.max(0, readNumericField(block.fields, ['DropDelay']) ?? 0);
    const dropOffset = readCoord3DField(block.fields, ['DropOffset']) ?? { x: 0, y: 0, z: 0 };
    const dropVariance = readCoord3DField(block.fields, ['DropVariance']) ?? { x: 0, y: 0, z: 0 };
    // Source parity: DeliverPayloadData fields (DeliverPayloadAIUpdate.cpp:67-90)
    // C++ INI::parseAngularVelocityReal: degrees/sec → radians/frame = value * PI / (180 * 30)
    const exitPitchRateDegPerSec = readNumericField(block.fields, ['ExitPitchRate']) ?? 0;
    const exitPitchRate = exitPitchRateDegPerSec * Math.PI / 5400;
    const parachuteDirectly = readBooleanField(block.fields, ['ParachuteDirectly']) ?? false;
    const maxAttempts = readNumericField(block.fields, ['MaxAttempts']) ?? 1;
    const diveStartDistance = readNumericField(block.fields, ['DiveStartDistance']) ?? 0;
    return {
      putInContainerTemplateName: putInContainerTemplateName || null,
      deliveryDistance,
      doorDelayFrames: self.msToLogicFrames(doorDelayMs),
      dropDelayFrames: self.msToLogicFrames(dropDelayMs),
      dropOffsetX: dropOffset.x,
      dropOffsetZ: dropOffset.y,
      dropVarianceX: Math.max(0, dropVariance.x),
      dropVarianceZ: Math.max(0, dropVariance.y),
      exitPitchRate,
      parachuteDirectly,
      maxAttempts,
      diveStartDistance,
    };
  }
  return null;
}

export function isScriptTeamPrototypeSingleton(self: GL, team: ScriptTeamRecord): boolean {
  if (team.maxInstances < 2) {
    return true;
  }
  return team.isSingleton;
}

export function createScriptTeamInstanceFromPrototype(self: GL, prototype: ScriptTeamRecord): ScriptTeamRecord {
  let suffix = 1;
  let instanceNameUpper = `${prototype.nameUpper}#${suffix}`;
  while (self.scriptTeamsByName.has(instanceNameUpper)) {
    suffix += 1;
    instanceNameUpper = `${prototype.nameUpper}#${suffix}`;
  }

  const instance: ScriptTeamRecord = {
    nameUpper: instanceNameUpper,
    prototypeNameUpper: prototype.nameUpper,
    sourcePrototypeId: prototype.sourcePrototypeId,
    sourceTeamId: null,
    memberEntityIds: new Set<number>(),
    created: false,
    stateName: '',
    attackPrioritySetName: '',
    recruitableOverride: prototype.recruitableOverride,
    isAIRecruitable: prototype.isAIRecruitable,
    homeWaypointName: prototype.homeWaypointName,
    controllingSide: prototype.controllingSide,
    controllingPlayerToken: prototype.controllingPlayerToken,
    isSingleton: false,
    maxInstances: prototype.maxInstances,
    productionPriority: prototype.productionPriority,
    productionPrioritySuccessIncrease: prototype.productionPrioritySuccessIncrease,
    productionPriorityFailureDecrease: prototype.productionPriorityFailureDecrease,
    reinforcementUnitEntries: prototype.reinforcementUnitEntries.map((entry) => ({ ...entry })),
    reinforcementTransportTemplateName: prototype.reinforcementTransportTemplateName,
    reinforcementStartWaypointName: prototype.reinforcementStartWaypointName,
    reinforcementTeamStartsFull: prototype.reinforcementTeamStartsFull,
    reinforcementTransportsExit: prototype.reinforcementTransportsExit,
  };
  self.scriptTeamsByName.set(instanceNameUpper, instance);
  registerScriptTeamPrototypeInstance(self, instance);
  return instance;
}

export function resolveScriptTeamBuildOrRecruitTarget(self: GL, prototype: ScriptTeamRecord): ScriptTeamRecord | null {
  if (isScriptTeamPrototypeSingleton(self, prototype)) {
    return prototype;
  }

  const allMaterializedInstances = getScriptTeamInstancesByPrototypeName(self, prototype.nameUpper, true);
  if (prototype.maxInstances > 0 && allMaterializedInstances.length >= prototype.maxInstances) {
    // Source parity: team-instance cap blocks additional materialization.
    return null;
  }
  return createScriptTeamInstanceFromPrototype(self, prototype);
}

export function executeScriptNamedDamage(self: GL, entityId: number, damageAmount: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  self.applyWeaponDamageAmount(null, entity, damageAmount, 'UNRESISTABLE', 'NORMAL');
  return true;
}

export function executeScriptNamedDelete(self: GL, entityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  self.silentDestroyEntity(entity.id);
  return true;
}

export function executeScriptTeamDelete(self: GL, teamName: string, ignoreDead: boolean): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const entities = getScriptTeamMemberEntities(self, team);
  for (const entity of entities) {
    if (ignoreDead && isScriptEntityEffectivelyDead(self, entity)) {
      continue;
    }
    if (entity.containProfile && self.collectContainedEntityIds(entity.id).length > 0) {
      self.evacuateContainedEntities(entity, entity.x, entity.z, null);
    }
    self.silentDestroyEntity(entity.id);
  }
  return true;
}

export function executeScriptNamedKill(self: GL, entityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  self.markEntityDestroyed(entity.id, -1);
  return true;
}

export function executeScriptTeamKill(self: GL, teamName: string): boolean {
  const team = getScriptTeamRecord(self, teamName);
  if (!team) {
    return false;
  }

  const entities = getScriptTeamMemberEntities(self, team);
  for (const entity of entities) {
    if (entity.containProfile && self.collectContainedEntityIds(entity.id).length > 0) {
      self.evacuateContainedEntities(entity, entity.x, entity.z, null);
    }
  }

  for (const entity of entities) {
    if (entity.destroyed) {
      continue;
    }
    if (isScriptEntityEffectivelyDead(self, entity) && !self.isBeaconEntity(entity)) {
      continue;
    }
    self.markEntityDestroyed(entity.id, -1);
  }
  return true;
}

export function executeScriptPlayerKill(self: GL, side: string): boolean {
  const normalizedSide = self.normalizeSide(side);
  if (!normalizedSide) {
    return false;
  }
  if (!collectScriptKnownSides(self).has(normalizedSide)) {
    return false;
  }
  self.killRemainingEntitiesForSide(normalizedSide);
  return true;
}

export function executeScriptPlayerTransferOwnershipPlayer(self: GL, sourceSide: string, targetSide: string): boolean {
  const sourceSelector = resolveScriptPlayerConditionSelector(self, sourceSide);
  const targetSelector = resolveScriptPlayerConditionSelector(self, targetSide);
  const normalizedSourceSide = sourceSelector.normalizedSide;
  const normalizedTargetSide = targetSelector.normalizedSide;
  if (!normalizedSourceSide || !normalizedTargetSide) {
    return false;
  }
  const knownSides = collectScriptKnownSides(self);
  if (!knownSides.has(normalizedSourceSide) || !knownSides.has(normalizedTargetSide)) {
    return false;
  }

  const entityIdsToTransfer: number[] = [];
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (self.normalizeSide(entity.side) !== normalizedSourceSide) {
      continue;
    }
    if (
      sourceSelector.explicitNamedPlayer
      && sourceSelector.controllingPlayerToken
      && self.resolveEntityControllingPlayerTokenForAffiliation(entity) !== sourceSelector.controllingPlayerToken
    ) {
      continue;
    }
    if (self.isBeaconEntity(entity)) {
      continue;
    }
    entityIdsToTransfer.push(entity.id);
  }

  for (const entityId of entityIdsToTransfer) {
    const entity = self.spawnedEntities.get(entityId);
    if (!entity || entity.destroyed) {
      continue;
    }
    self.transferScriptEntityToSide(
      entity,
      normalizedTargetSide,
      targetSelector.controllingPlayerToken,
    );
  }

  const transferredCredits = self.getSideCredits(normalizedSourceSide);
  self.setSideCredits(normalizedSourceSide, 0);
  self.depositSideCredits(normalizedTargetSide, transferredCredits);
  return true;
}

export function executeScriptNamedTransferOwnershipPlayer(self: GL, entityId: number, targetSide: string): boolean {
  const entity = self.spawnedEntities.get(entityId);
  const targetSelector = resolveScriptPlayerConditionSelector(self, targetSide);
  const normalizedTargetSide = targetSelector.normalizedSide;
  if (!entity || entity.destroyed || !normalizedTargetSide) {
    return false;
  }
  if (!collectScriptKnownSides(self).has(normalizedTargetSide)) {
    return false;
  }
  self.transferScriptEntityToSide(
    entity,
    normalizedTargetSide,
    targetSelector.controllingPlayerToken,
  );
  return true;
}

export function executeScriptTeamDeleteLiving(self: GL, teamName: string): boolean {
  return executeScriptTeamDelete(self, teamName, true);
}

export function executeScriptOversizeTerrain(self: GL, amount: number): boolean {
  if (!Number.isFinite(amount)) {
    return false;
  }
  self.setScriptTerrainOversizeAmount(amount);
  return true;
}

export function executeScriptResizeViewGuardband(self: GL, guardbandX: number, guardbandY: number): boolean {
  if (!Number.isFinite(guardbandX) || !Number.isFinite(guardbandY)) {
    return false;
  }
  self.setScriptViewGuardbandBias(guardbandX, guardbandY);
  return true;
}

export function executeScriptDeleteAllUnmanned(self: GL): boolean {
  const unmannedEntityIds: number[] = [];
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (!entity.objectStatusFlags.has('DISABLED_UNMANNED')) {
      continue;
    }
    unmannedEntityIds.push(entity.id);
  }

  for (const entityId of unmannedEntityIds) {
    self.markEntityDestroyed(entityId, -1);
  }
  return true;
}

export function executeScriptChooseVictimAlwaysUsesNormal(self: GL, enabled: boolean): boolean {
  self.setScriptChooseVictimAlwaysUsesNormal(enabled);
  return true;
}

export function clearScriptTeamByNameUpper(self: GL, teamNameUpper: string): boolean {
  const team = self.scriptTeamsByName.get(teamNameUpper) ?? null;
  if (!team) {
    return false;
  }

  unregisterScriptTeamPrototypeInstance(self, team);
  const removed = self.scriptTeamsByName.delete(team.nameUpper);
  if (removed) {
    self.removeAllSequentialScriptsForTeam(team.nameUpper);
    self.scriptTeamCreatedReadyFrameByName.delete(team.nameUpper);
    self.scriptTeamCreatedAutoClearFrameByName.delete(team.nameUpper);
    for (const [side, defaultTeamNameUpper] of self.scriptDefaultTeamNameBySide) {
      if (defaultTeamNameUpper === team.nameUpper) {
        self.scriptDefaultTeamNameBySide.delete(side);
      }
    }
    if (self.scriptCallingTeamNameUpper === team.nameUpper) {
      self.scriptCallingTeamNameUpper = null;
    }
    if (self.scriptConditionTeamNameUpper === team.nameUpper) {
      self.scriptConditionTeamNameUpper = null;
    }
    if (self.scriptLocalPlayerTeamNameUpper === team.nameUpper) {
      self.scriptLocalPlayerTeamNameUpper = null;
    }
  }
  return removed;
}

export function resolveScriptTeamTriggerIndex(self: GL, triggerName: string): number {
  const triggerNameUpper = triggerName.trim().toUpperCase();
  if (!triggerNameUpper) {
    return -1;
  }
  return self.mapTriggerRegions.findIndex((region) => region.nameUpper === triggerNameUpper);
}

export function getScriptPlayerPowerState(self: GL, sideInput: string): SidePowerState | null {
  const selector = resolveScriptPlayerConditionSelector(self, sideInput);
  const normalizedSide = selector.normalizedSide;
  if (!normalizedSide) {
    return null;
  }
  const targetToken = selector.explicitNamedPlayer ? selector.controllingPlayerToken : null;
  if (!targetToken) {
    return self.getSidePowerState(normalizedSide);
  }

  let energyProduction = 0;
  let energyConsumption = 0;
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (self.normalizeSide(entity.side) !== normalizedSide) {
      continue;
    }
    const ownerToken = self.resolveEntityControllingPlayerTokenForAffiliation(entity);
    if (!ownerToken || ownerToken !== targetToken) {
      continue;
    }
    if (entity.energyBonus > 0) {
      energyProduction += entity.energyBonus;
    } else if (entity.energyBonus < 0) {
      energyConsumption += -entity.energyBonus;
    }
  }

  const sideState = self.getSidePowerState(normalizedSide);
  const totalProduction = energyProduction;
  const brownedOut = energyConsumption > 0 && totalProduction < energyConsumption;
  return {
    powerBonus: 0,
    energyProduction,
    energyConsumption,
    brownedOut,
    powerSabotagedUntilFrame: sideState.powerSabotagedUntilFrame,
  };
}

export function getScriptScienceSetForPlayerToken(self: GL, 
  controllingPlayerToken: string,
  normalizedSide: string,
): Set<string> {
  const existing = self.controllingPlayerScriptSciences.get(controllingPlayerToken);
  if (existing) {
    return existing;
  }
  const created = new Set<string>(self.getSideScienceSet(normalizedSide));
  self.controllingPlayerScriptSciences.set(controllingPlayerToken, created);
  return created;
}

export function getScriptScienceAcquiredEventSetForPlayerToken(self: GL, controllingPlayerToken: string): Set<string> {
  const existing = self.controllingPlayerScriptAcquiredSciences.get(controllingPlayerToken);
  if (existing) {
    return existing;
  }
  const created = new Set<string>();
  self.controllingPlayerScriptAcquiredSciences.set(controllingPlayerToken, created);
  return created;
}

export function getScriptSciencePurchasePointsForPlayerInput(self: GL, sideInput: string): number {
  const selector = resolveScriptPlayerConditionSelector(self, sideInput);
  const normalizedSide = selector.normalizedSide;
  if (!normalizedSide) {
    return 0;
  }
  if (selector.explicitNamedPlayer && selector.controllingPlayerToken) {
    const overridePoints = self.controllingPlayerScriptSciencePurchasePoints.get(selector.controllingPlayerToken);
    if (overridePoints !== undefined) {
      return overridePoints;
    }
  }
  return self.getSideRankStateMap(normalizedSide).sciencePurchasePoints;
}

export function grantScriptScienceForPlayerInput(self: GL, sideInput: string, scienceName: string): boolean {
  const selector = resolveScriptPlayerConditionSelector(self, sideInput);
  const normalizedSide = selector.normalizedSide;
  if (!normalizedSide) {
    return false;
  }
  if (!selector.explicitNamedPlayer || !selector.controllingPlayerToken) {
    return self.grantSideScience(normalizedSide, scienceName);
  }
  if (countScriptPlayersForSide(self, normalizedSide) <= 1) {
    return self.grantSideScience(normalizedSide, scienceName);
  }

  const normalizedScience = self.resolveScienceInternalName(scienceName);
  if (!normalizedScience) {
    return false;
  }
  const registry = self.iniDataRegistry;
  if (!registry) {
    return false;
  }
  const scienceDef = findScienceDefByName(registry, normalizedScience);
  if (!scienceDef) {
    return false;
  }
  if (readBooleanField(scienceDef.fields, ['IsGrantable']) === false) {
    return false;
  }

  const scienceSet = getScriptScienceSetForPlayerToken(self, selector.controllingPlayerToken, normalizedSide);
  if (scienceSet.has(normalizedScience)) {
    return false;
  }
  scienceSet.add(normalizedScience);
  getScriptScienceAcquiredEventSetForPlayerToken(self, selector.controllingPlayerToken).add(normalizedScience);
  return true;
}

export function purchaseScriptScienceForPlayerInput(self: GL, sideInput: string, scienceName: string): boolean {
  const selector = resolveScriptPlayerConditionSelector(self, sideInput);
  const normalizedSide = selector.normalizedSide;
  if (!normalizedSide) {
    return false;
  }
  const normalizedScience = self.resolveScienceInternalName(scienceName);
  if (!normalizedScience) {
    return false;
  }
  if (!self.canScriptPlayerPurchaseScience(sideInput, normalizedScience)) {
    return false;
  }

  const registry = self.iniDataRegistry;
  if (!registry) {
    return false;
  }
  const scienceDef = findScienceDefByName(registry, normalizedScience);
  if (!scienceDef) {
    return false;
  }
  const scienceCost = self.getSciencePurchaseCost(scienceDef);
  if (scienceCost <= 0) {
    return false;
  }

  if (!selector.explicitNamedPlayer || !selector.controllingPlayerToken || countScriptPlayersForSide(self, normalizedSide) <= 1) {
    if (!self.addScienceToSide(normalizedSide, normalizedScience)) {
      return false;
    }
    const rankState = self.getSideRankStateMap(normalizedSide);
    rankState.sciencePurchasePoints = Math.max(0, rankState.sciencePurchasePoints - scienceCost);
    return true;
  }

  const scienceSet = getScriptScienceSetForPlayerToken(self, selector.controllingPlayerToken, normalizedSide);
  if (scienceSet.has(normalizedScience)) {
    return false;
  }
  scienceSet.add(normalizedScience);
  getScriptScienceAcquiredEventSetForPlayerToken(self, selector.controllingPlayerToken).add(normalizedScience);
  const currentPoints = getScriptSciencePurchasePointsForPlayerInput(self, sideInput);
  self.controllingPlayerScriptSciencePurchasePoints.set(
    selector.controllingPlayerToken,
    Math.max(0, currentPoints - scienceCost),
  );
  return true;
}

export function recordScriptTriggeredSpecialPowerEvent(self: GL, 
  normalizedSide: string,
  specialPowerName: string,
  sourceEntityId: number,
): void {
  const normalizedSpecialPowerName = self.normalizeShortcutSpecialPowerName(specialPowerName);
  if (!normalizedSpecialPowerName || !Number.isFinite(sourceEntityId)) {
    return;
  }

  const normalizedSourceEntityId = Math.trunc(sourceEntityId);
  if (normalizedSourceEntityId <= 0) {
    return;
  }

  getScriptTriggeredSpecialPowerEvents(self, normalizedSide).push({
    name: normalizedSpecialPowerName,
    sourceEntityId: normalizedSourceEntityId,
  });
}

export function recordScriptCompletedSpecialPowerEvent(self: GL, 
  normalizedSide: string,
  specialPowerName: string,
  sourceEntityId: number,
): void {
  const normalizedSpecialPowerName = self.normalizeShortcutSpecialPowerName(specialPowerName);
  if (!normalizedSpecialPowerName || !Number.isFinite(sourceEntityId)) {
    return;
  }

  const normalizedSourceEntityId = Math.trunc(sourceEntityId);
  if (normalizedSourceEntityId <= 0) {
    return;
  }

  getScriptCompletedSpecialPowerEvents(self, normalizedSide).push({
    name: normalizedSpecialPowerName,
    sourceEntityId: normalizedSourceEntityId,
  });
}

export function recordScriptCompletedUpgradeEvent(self: GL, 
  normalizedSide: string,
  upgradeName: string,
  sourceEntityId: number,
): void {
  const normalizedUpgradeName = upgradeName.trim().toUpperCase();
  if (!normalizedUpgradeName || normalizedUpgradeName === 'NONE') {
    return;
  }
  if (!Number.isFinite(sourceEntityId)) {
    return;
  }
  const normalizedSourceEntityId = Math.trunc(sourceEntityId);
  if (normalizedSourceEntityId <= 0) {
    return;
  }

  getScriptCompletedUpgradeEvents(self, normalizedSide).push({
    name: normalizedUpgradeName,
    sourceEntityId: normalizedSourceEntityId,
  });
}

export function getScriptScienceAcquiredSet(self: GL, normalizedSide: string): Set<string> {
  const existing = self.sideScriptAcquiredSciences.get(normalizedSide);
  if (existing) {
    return existing;
  }
  const created = new Set<string>();
  self.sideScriptAcquiredSciences.set(normalizedSide, created);
  return created;
}

export function getScriptTriggeredSpecialPowerEvents(self: GL, normalizedSide: string): ScriptNamedEvent[] {
  const existing = self.sideScriptTriggeredSpecialPowerEvents.get(normalizedSide);
  if (existing) {
    return existing;
  }
  const created: ScriptNamedEvent[] = [];
  self.sideScriptTriggeredSpecialPowerEvents.set(normalizedSide, created);
  return created;
}

export function getScriptCompletedSpecialPowerEvents(self: GL, normalizedSide: string): ScriptNamedEvent[] {
  const existing = self.sideScriptCompletedSpecialPowerEvents.get(normalizedSide);
  if (existing) {
    return existing;
  }
  const created: ScriptNamedEvent[] = [];
  self.sideScriptCompletedSpecialPowerEvents.set(normalizedSide, created);
  return created;
}

export function getScriptCompletedUpgradeEvents(self: GL, normalizedSide: string): ScriptNamedEvent[] {
  const existing = self.sideScriptCompletedUpgradeEvents.get(normalizedSide);
  if (existing) {
    return existing;
  }
  const created: ScriptNamedEvent[] = [];
  self.sideScriptCompletedUpgradeEvents.set(normalizedSide, created);
  return created;
}

export function resolveScriptObjectStatusMaskFromInput(self: GL, value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return Math.trunc(numeric);
    }

    let mask = 0;
    let found = false;
    for (const token of trimmed.split(/\s+/)) {
      const normalized = self.normalizeObjectStatusName(token);
      if (!normalized) {
        continue;
      }
      const bitIndex = SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME.get(normalized);
      if (bitIndex === undefined) {
        continue;
      }
      mask |= 1 << bitIndex;
      found = true;
    }
    return found ? mask : null;
  }
  return null;
}

export function resolveScriptObjectStatusTokens(self: GL, value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return [];
  }
  return trimmed
    .split(/\s+/)
    .map((token) => self.normalizeObjectStatusName(token))
    .filter((token): token is string => Boolean(token));
}

export function normalizeScriptVariableName(self: GL, name: string): string {
  return name.trim();
}

export function normalizeScriptObjectName(self: GL, name: string): string {
  return name.trim();
}

export function normalizeScriptObjectTypeName(self: GL, name: string): string {
  return name.trim().toUpperCase();
}

export function resolveScriptObjectTypeEntriesForCondition(self: GL, objectTypeName: string): string[] {
  const normalizedName = normalizeScriptObjectTypeName(self, objectTypeName);
  if (!normalizedName) {
    return [];
  }
  const list = self.scriptObjectTypeListsByName.get(normalizedName);
  if (list && list.length > 0) {
    return [...list];
  }
  return [normalizedName];
}

export function resolveScriptObjectTypeCandidatesForAction(self: GL, objectTypeName: string): string[] | null {
  const normalizedName = normalizeScriptObjectTypeName(self, objectTypeName);
  if (!normalizedName) {
    return null;
  }
  if (self.resolveObjectDefByTemplateName(normalizedName)) {
    return [normalizedName];
  }
  const list = self.scriptObjectTypeListsByName.get(normalizedName);
  if (list && list.length > 0) {
    return [...list];
  }
  return null;
}

export function resolveScriptEntityIdFromValue(self: GL, value: unknown, allowDead: boolean): number | null {
  let entityId: number | null = null;
  let normalizedName: string | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    entityId = Math.trunc(value);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed === SCRIPT_THIS_OBJECT) {
      const contextId = resolveScriptContextEntityId(self);
      if (contextId === null) {
        return null;
      }
      entityId = contextId;
    } else {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        entityId = Math.trunc(parsed);
      } else {
        normalizedName = normalizeScriptObjectName(self, trimmed);
        if (!normalizedName) {
          return null;
        }
        const mappedId = self.scriptNamedEntitiesByName.get(normalizedName);
        if (mappedId === undefined) {
          return null;
        }
        entityId = mappedId;
      }
    }
  }
  if (!entityId || entityId <= 0) {
    return null;
  }
  const entity = self.spawnedEntities.get(entityId);
  if (!entity) {
    return null;
  }
  if (normalizedName && entity.scriptName !== normalizedName) {
    return null;
  }
  if (!allowDead && entity.destroyed) {
    return null;
  }
  return entityId;
}

export function resolveScriptEntityId(self: GL, value: unknown): number | null {
  return resolveScriptEntityIdFromValue(self, value, false);
}

export function resolveScriptEntityIdForCondition(self: GL, value: unknown): number | null {
  return resolveScriptEntityIdFromValue(self, value, true);
}

export function resolveScriptEntityConditionRef(self: GL, value: unknown): { entityId: number | null; didExist: boolean } {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const entityId = Math.trunc(value);
    if (entityId <= 0) {
      return { entityId: null, didExist: false };
    }
    const entity = self.spawnedEntities.get(entityId);
    const didExist = self.scriptExistedEntityIds.has(entityId) || entity !== undefined;
    return { entityId: entity ? entityId : null, didExist };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return { entityId: null, didExist: false };
    }
    if (trimmed === SCRIPT_THIS_OBJECT) {
      const contextId = resolveScriptContextEntityId(self);
      if (contextId === null) {
        return { entityId: null, didExist: false };
      }
      return resolveScriptEntityConditionRef(self, contextId);
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return resolveScriptEntityConditionRef(self, parsed);
    }
    const normalizedName = normalizeScriptObjectName(self, trimmed);
    if (!normalizedName) {
      return { entityId: null, didExist: false };
    }
    const mappedId = self.scriptNamedEntitiesByName.get(normalizedName);
    if (mappedId === undefined) {
      return { entityId: null, didExist: false };
    }
    const entity = self.spawnedEntities.get(mappedId);
    if (!entity || entity.scriptName !== normalizedName) {
      return { entityId: null, didExist: true };
    }
    return { entityId: mappedId, didExist: true };
  }
  return { entityId: null, didExist: false };
}

export function registerScriptNamedEntity(self: GL, entity: MapEntity): void {
  if (!entity.scriptName) {
    return;
  }
  const normalizedName = normalizeScriptObjectName(self, entity.scriptName);
  if (!normalizedName) {
    entity.scriptName = null;
    return;
  }
  entity.scriptName = normalizedName;
  const existingId = self.scriptNamedEntitiesByName.get(normalizedName);
  if (existingId !== undefined && existingId !== entity.id) {
    const existingEntity = self.spawnedEntities.get(existingId);
    if (!existingEntity || existingEntity.destroyed || existingEntity.scriptName !== normalizedName) {
      self.scriptNamedEntitiesByName.set(normalizedName, entity.id);
    }
    return;
  }
  self.scriptNamedEntitiesByName.set(normalizedName, entity.id);
}

export function resolveScriptActionTypeName(self: GL, rawType: unknown): string | null {
  if (typeof rawType === 'number') {
    if (!Number.isFinite(rawType)) {
      return null;
    }
    return SCRIPT_ACTION_TYPE_NUMERIC_TO_NAME.get(Math.trunc(rawType)) ?? null;
  }

  if (typeof rawType !== 'string') {
    return null;
  }

  const normalized = rawType.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const canonical = SCRIPT_ACTION_TYPE_ALIASES.get(normalized) ?? normalized;
  if (!SCRIPT_ACTION_TYPE_NAME_SET.has(canonical) && !SCRIPT_ACTION_TYPE_EXTRA_NAMES.has(canonical)) {
    return null;
  }
  return canonical;
}

export function resolveScriptRandomInt(self: GL, minValue: number, maxValue: number): number {
  const min = Number.isFinite(minValue) ? Math.trunc(minValue) : 0;
  const max = Number.isFinite(maxValue) ? Math.trunc(maxValue) : 0;
  if (max <= min) {
    return max;
  }
  return self.gameRandom.nextRange(min, max);
}

export function resolveScriptRandomReal(self: GL, minValue: number, maxValue: number): number {
  const min = Number.isFinite(minValue) ? minValue : 0;
  const max = Number.isFinite(maxValue) ? maxValue : 0;
  if (max <= min) {
    return max;
  }
  return min + self.gameRandom.nextFloat() * (max - min);
}

export function secondsToScriptTimerFrames(self: GL, seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return 0;
  }
  return Math.ceil((seconds * 1000) / LOGIC_FRAME_MS);
}

export function resolveScriptConditionTypeName(self: GL, rawType: unknown): string | null {
  if (typeof rawType === 'number') {
    if (!Number.isFinite(rawType)) {
      return null;
    }
    const index = Math.trunc(rawType);
    if (index < 0 || index >= SCRIPT_CONDITION_TYPE_NAMES_BY_INDEX.length - 1) {
      return null;
    }
    return SCRIPT_CONDITION_TYPE_NAMES_BY_INDEX[index] ?? null;
  }

  if (typeof rawType !== 'string') {
    return null;
  }

  const normalized = rawType.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const canonical = SCRIPT_CONDITION_TYPE_ALIASES.get(normalized) ?? normalized;
  if (canonical === 'NUM_ITEMS' || !SCRIPT_CONDITION_TYPE_NAME_SET.has(canonical)) {
    return null;
  }
  return canonical;
}

export function resolveScriptConditionParams(self: GL, condition: Record<string, unknown>): {
  paramsObject: Record<string, unknown> | null;
  paramsArray: readonly unknown[];
} {
  const tryParse = (raw: unknown): { obj: Record<string, unknown> | null; arr: readonly unknown[] } | null => {
    if (Array.isArray(raw)) {
      return { obj: null, arr: raw };
    }
    if (raw && typeof raw === 'object') {
      return { obj: raw as Record<string, unknown>, arr: [] };
    }
    return null;
  };

  const primary = tryParse(condition.params);
  if (primary) {
    return { paramsObject: primary.obj, paramsArray: primary.arr };
  }

  const secondary = tryParse(condition.parameters);
  if (secondary) {
    return { paramsObject: secondary.obj, paramsArray: secondary.arr };
  }

  return { paramsObject: null, paramsArray: [] };
}

export function resolveScriptConditionParamValue(self: GL, 
  condition: Record<string, unknown>,
  paramsObject: Record<string, unknown> | null,
  paramsArray: readonly unknown[],
  index: number,
  keyNames: readonly string[],
): unknown {
  for (const keyName of keyNames) {
    if (!keyName) {
      continue;
    }
    if (paramsObject && Object.prototype.hasOwnProperty.call(paramsObject, keyName)) {
      return paramsObject[keyName];
    }
    if (Object.prototype.hasOwnProperty.call(condition, keyName)) {
      return condition[keyName];
    }
  }

  if (index >= 0 && index < paramsArray.length) {
    return paramsArray[index];
  }

  return undefined;
}

export function coerceScriptConditionString(self: GL, value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  return '';
}

export function coerceScriptConditionNumber(self: GL, value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function coerceScriptConditionBoolean(self: GL, value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return defaultValue;
    }
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (!normalized) {
      return defaultValue;
    }
    if (
      normalized === 'TRUE'
      || normalized === 'YES'
      || normalized === 'ON'
      || normalized === '1'
    ) {
      return true;
    }
    if (
      normalized === 'FALSE'
      || normalized === 'NO'
      || normalized === 'OFF'
      || normalized === '0'
    ) {
      return false;
    }
  }
  return defaultValue;
}

export function coerceScriptConditionCoord3(self: GL, value: unknown): { x: number; y: number; z: number } | null {
  const readNumber = (raw: unknown): number | null => {
    if (typeof raw === 'number') {
      return Number.isFinite(raw) ? raw : null;
    }
    if (typeof raw === 'string') {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  if (Array.isArray(value)) {
    const x = readNumber(value[0]) ?? 0;
    const y = readNumber(value[1]) ?? 0;
    const z = readNumber(value[2]) ?? 0;
    return { x, y, z };
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const x = readNumber(record.x ?? record.X) ?? 0;
    const y = readNumber(record.y ?? record.Y) ?? 0;
    const z = readNumber(record.z ?? record.Z) ?? 0;
    return { x, y, z };
  }
  return null;
}

export function coerceScriptBuildableStatus(self: GL, value: unknown): BuildableStatus {
  const numericStatus = coerceScriptConditionNumber(self, value);
  if (numericStatus !== null) {
    const normalizedStatus = Math.trunc(numericStatus);
    if (normalizedStatus === 1) {
      return 'IGNORE_PREREQUISITES';
    }
    if (normalizedStatus === 2) {
      return 'NO';
    }
    if (normalizedStatus === 3) {
      return 'ONLY_BY_AI';
    }
    return 'YES';
  }

  const token = coerceScriptConditionString(self, value).trim().toUpperCase();
  if (token === 'IGNORE_PREREQUISITES') {
    return 'IGNORE_PREREQUISITES';
  }
  if (token === 'NO') {
    return 'NO';
  }
  if (token === 'ONLY_BY_AI') {
    return 'ONLY_BY_AI';
  }
  return 'YES';
}

export function resolveScriptConditionCacheId(self: GL, 
  condition: Record<string, unknown>,
  paramsObject: Record<string, unknown> | null,
): string | undefined {
  const rawCacheId = resolveScriptConditionParamValue(self, 
    condition,
    paramsObject,
    [],
    -1,
    ['conditionCacheId', 'cacheId'],
  );
  if (typeof rawCacheId === 'string') {
    const normalized = rawCacheId.trim();
    if (normalized) {
      return normalized;
    }
  }

  const rawConditionId = condition.id ?? condition.conditionId;
  if (typeof rawConditionId === 'string') {
    const normalized = rawConditionId.trim();
    if (normalized) {
      return `SCRIPT_CONDITION:${normalized}`;
    }
  } else if (typeof rawConditionId === 'number' && Number.isFinite(rawConditionId)) {
    return `SCRIPT_CONDITION:${Math.trunc(rawConditionId)}`;
  }

  return undefined;
}

export function countScriptObjectsByTemplateForSide(self: GL, 
  normalizedSide: string,
  normalizedTemplateName: string,
  controllingPlayerToken?: string | null,
): number {
  const normalizedOwnerToken = self.normalizeControllingPlayerToken(controllingPlayerToken ?? undefined);
  let count = 0;
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (self.normalizeSide(entity.side) !== normalizedSide) {
      continue;
    }
    if (entity.objectStatusFlags.has('UNDER_CONSTRUCTION')) {
      continue;
    }
    if (normalizedOwnerToken !== null) {
      const ownerToken = self.resolveEntityControllingPlayerTokenForAffiliation(entity);
      if (!ownerToken || ownerToken !== normalizedOwnerToken) {
        continue;
      }
    }
    if (!self.areEquivalentTemplateNames(entity.templateName, normalizedTemplateName)) {
      continue;
    }
    count += 1;
  }
  return count;
}

export function countScriptObjectsByTemplateListForSide(self: GL, 
  normalizedSide: string,
  templateNames: string[],
  controllingPlayerToken?: string | null,
): number {
  const normalizedTemplates = Array.from(new Set(
    templateNames
      .map((name) => normalizeScriptObjectTypeName(self, name))
      .filter(Boolean),
  ));
  if (normalizedTemplates.length === 0) {
    return 0;
  }
  const normalizedOwnerToken = self.normalizeControllingPlayerToken(controllingPlayerToken ?? undefined);

  let count = 0;
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (self.normalizeSide(entity.side) !== normalizedSide) {
      continue;
    }
    if (entity.objectStatusFlags.has('UNDER_CONSTRUCTION')) {
      continue;
    }
    if (normalizedOwnerToken !== null) {
      const ownerToken = self.resolveEntityControllingPlayerTokenForAffiliation(entity);
      if (!ownerToken || ownerToken !== normalizedOwnerToken) {
        continue;
      }
    }
    if (!self.matchesScriptObjectTypeList(entity.templateName, normalizedTemplates)) {
      continue;
    }
    count += 1;
  }
  return count;
}

export function countScriptStructuresForSide(self: GL, 
  normalizedSide: string,
  requireVictoryFlag: boolean,
  controllingPlayerToken?: string | null,
): number {
  const normalizedOwnerToken = self.normalizeControllingPlayerToken(controllingPlayerToken ?? undefined);
  let count = 0;
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (self.normalizeSide(entity.side) !== normalizedSide) {
      continue;
    }
    if (normalizedOwnerToken !== null) {
      const ownerToken = self.resolveEntityControllingPlayerTokenForAffiliation(entity);
      if (!ownerToken || ownerToken !== normalizedOwnerToken) {
        continue;
      }
    }
    if (!entity.kindOf.has('STRUCTURE')) {
      continue;
    }
    if (requireVictoryFlag && !entity.kindOf.has('MP_COUNT_FOR_VICTORY')) {
      continue;
    }
    count += 1;
  }
  return count;
}

export function resolveScriptComparisonCode(self: GL, comparison: ScriptComparisonInput): number | null {
  if (typeof comparison === 'number') {
    if (!Number.isFinite(comparison)) {
      return null;
    }
    const code = Math.trunc(comparison);
    return code >= 0 && code <= 5 ? code : null;
  }

  switch (comparison.trim().toUpperCase()) {
    case 'LESS_THAN':
      return 0;
    case 'LESS_EQUAL':
      return 1;
    case 'EQUAL':
      return 2;
    case 'GREATER_EQUAL':
      return 3;
    case 'GREATER':
      return 4;
    case 'NOT_EQUAL':
      return 5;
    default:
      return null;
  }
}

export function normalizeScriptCompletionName(self: GL, name: string): string {
  return name.trim();
}

export function clearScriptCompletedName(self: GL, list: string[], name: string): void {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index] === name) {
      list.splice(index, 1);
    }
  }
}

export function clearScriptAudioCompletionState(self: GL, audioName: string): void {
  const normalizedName = normalizeScriptCompletionName(self, audioName);
  if (!normalizedName) {
    return;
  }
  clearScriptCompletedName(self, self.scriptCompletedSpeech, normalizedName);
  clearScriptCompletedName(self, self.scriptCompletedAudio, normalizedName);
  self.scriptTestingSpeechCompletionFrameByName.delete(normalizedName);
  self.scriptTestingAudioCompletionFrameByName.delete(normalizedName);
}

export function clearScriptMusicCompletionState(self: GL, trackName: string): void {
  const normalizedName = normalizeScriptCompletionName(self, trackName);
  if (!normalizedName) {
    return;
  }
  for (let index = self.scriptCompletedMusic.length - 1; index >= 0; index -= 1) {
    if (self.scriptCompletedMusic[index]!.name === normalizedName) {
      self.scriptCompletedMusic.splice(index, 1);
    }
  }
}

export function normalizeScriptTeamName(self: GL, teamName: string): string {
  return teamName.trim().toUpperCase();
}

export function normalizeScriptTeamContextName(self: GL, teamName: string): string | null {
  const trimmed = teamName.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === SCRIPT_THIS_TEAM || trimmed === SCRIPT_TEAM_THE_PLAYER) {
    return null;
  }
  return normalizeScriptTeamName(self, trimmed);
}

export function resolveScriptContextTeamRecord(self: GL): ScriptTeamRecord | null {
  if (self.scriptCallingTeamNameUpper) {
    const calling = self.scriptTeamsByName.get(self.scriptCallingTeamNameUpper) ?? null;
    if (calling) {
      return calling;
    }
  }
  if (self.scriptConditionTeamNameUpper) {
    return self.scriptTeamsByName.get(self.scriptConditionTeamNameUpper) ?? null;
  }
  return null;
}

export function resolveScriptContextTeamName(self: GL): string | null {
  return resolveScriptContextTeamRecord(self)?.nameUpper ?? null;
}

export function resolveScriptTeamName(self: GL, teamName: string): string | null {
  const trimmed = teamName.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === SCRIPT_THIS_TEAM) {
    return resolveScriptContextTeamName(self);
  }
  if (trimmed === SCRIPT_TEAM_THE_PLAYER) {
    if (self.scriptLocalPlayerTeamNameUpper) {
      return self.scriptLocalPlayerTeamNameUpper;
    }
    const localSide = self.resolveLocalPlayerSide();
    if (!localSide) {
      return null;
    }
    return self.scriptDefaultTeamNameBySide.get(localSide) ?? null;
  }
  return normalizeScriptTeamName(self, trimmed);
}

export function resolveScriptConditionTeams(self: GL, teamName: string): ScriptTeamRecord[] {
  const desiredTeamToken = teamName.trim();
  if (!desiredTeamToken) {
    return [];
  }

  // Source parity bridge: explicit THIS_TEAM / teamThePlayer tokens resolve
  // through context-aware getTeamNamed() behavior.
  if (desiredTeamToken === SCRIPT_THIS_TEAM || desiredTeamToken === SCRIPT_TEAM_THE_PLAYER) {
    const resolved = getScriptTeamRecord(self, desiredTeamToken);
    return resolved ? [resolved] : [];
  }

  const desiredTeamNameUpper = resolveScriptTeamName(self, desiredTeamToken);
  if (!desiredTeamNameUpper) {
    return [];
  }

  // Source parity bridge: when a condition is currently iterating team instances,
  // use that contextual team if it matches by name or prototype.
  const thisTeam = getScriptTeamRecord(self, SCRIPT_THIS_TEAM);
  if (thisTeam && isScriptTeamNameMatch(self, thisTeam, desiredTeamNameUpper)) {
    return [thisTeam];
  }

  // Source parity bridge: resolve TeamPrototype references across all active instances.
  const prototypeInstances = getScriptTeamInstancesByPrototypeName(self, desiredTeamNameUpper);
  if (prototypeInstances.length > 0) {
    return prototypeInstances;
  }

  const direct = self.scriptTeamsByName.get(desiredTeamNameUpper);
  return direct ? [direct] : [];
}

export function registerScriptTeamPrototypeInstance(self: GL, team: ScriptTeamRecord): void {
  const prototypeNameUpper = team.prototypeNameUpper;
  let instanceNames = self.scriptTeamInstanceNamesByPrototypeName.get(prototypeNameUpper);
  if (!instanceNames) {
    instanceNames = [];
    self.scriptTeamInstanceNamesByPrototypeName.set(prototypeNameUpper, instanceNames);
  }
  if (!instanceNames.includes(team.nameUpper)) {
    instanceNames.push(team.nameUpper);
  }
}

export function unregisterScriptTeamPrototypeInstance(self: GL, team: ScriptTeamRecord): void {
  const instanceNames = self.scriptTeamInstanceNamesByPrototypeName.get(team.prototypeNameUpper);
  if (!instanceNames) {
    return;
  }
  const index = instanceNames.indexOf(team.nameUpper);
  if (index >= 0) {
    instanceNames.splice(index, 1);
  }
  if (instanceNames.length === 0) {
    self.scriptTeamInstanceNamesByPrototypeName.delete(team.prototypeNameUpper);
  }
}

export function getScriptTeamInstancesByPrototypeName(self: GL, 
  prototypeNameUpper: string,
  includeInactive = false,
): ScriptTeamRecord[] {
  const instanceNames = self.scriptTeamInstanceNamesByPrototypeName.get(prototypeNameUpper);
  if (!instanceNames || instanceNames.length === 0) {
    return [];
  }
  const teams: ScriptTeamRecord[] = [];
  for (const instanceName of instanceNames) {
    const team = self.scriptTeamsByName.get(instanceName);
    if (!team) {
      continue;
    }

    const isPrototypePlaceholder = team.nameUpper === prototypeNameUpper
      && team.prototypeNameUpper === prototypeNameUpper
      && !team.created
      && team.memberEntityIds.size === 0;
    if (isPrototypePlaceholder) {
      continue;
    }

    // Source parity: TeamPrototype iteration only considers active instances.
    if (!includeInactive && !team.created && team.memberEntityIds.size === 0) {
      continue;
    }
    teams.push(team);
  }
  return teams;
}

export function isScriptTeamNameMatch(self: GL, team: ScriptTeamRecord, desiredNameUpper: string): boolean {
  return team.nameUpper === desiredNameUpper || team.prototypeNameUpper === desiredNameUpper;
}

export function resolveScriptContextEntityId(self: GL): number | null {
  return self.scriptCallingEntityId ?? self.scriptConditionEntityId;
}

export function resolveScriptCurrentPlayerSideFromContext(self: GL): string | null {
  if (self.scriptCurrentPlayerSide) {
    return self.scriptCurrentPlayerSide;
  }

  const teamName = resolveScriptContextTeamName(self);
  if (teamName) {
    const team = self.scriptTeamsByName.get(teamName);
    const controllingSide = team ? resolveScriptTeamControllingSide(self, team) : null;
    if (controllingSide) {
      return controllingSide;
    }
  }

  const entityId = resolveScriptContextEntityId(self);
  if (entityId !== null) {
    const entity = self.spawnedEntities.get(entityId);
    const entitySide = entity ? self.normalizeSide(entity.side) : '';
    if (entitySide) {
      return entitySide;
    }
  }

  return null;
}

export function resolveScriptPlayerSideFromInput(self: GL, playerName: string): string | null {
  const trimmed = playerName.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === SCRIPT_LOCAL_PLAYER || trimmed === SCRIPT_THE_PLAYER) {
    return self.resolveLocalPlayerSide();
  }
  if (trimmed === SCRIPT_THIS_PLAYER) {
    return resolveScriptCurrentPlayerSideFromContext(self);
  }
  if (trimmed === SCRIPT_THIS_PLAYER_ENEMY) {
    const currentSide = resolveScriptCurrentPlayerSideFromContext(self);
    if (!currentSide) {
      return null;
    }
    return resolveScriptSkirmishEnemySide(self, currentSide);
  }
  const mappedSide = self.scriptPlayerSideByName.get(trimmed.toUpperCase());
  if (mappedSide) {
    return mappedSide;
  }
  const normalized = self.normalizeSide(trimmed);
  return normalized || null;
}

export function resolveScriptControllingPlayerTokenFromInput(self: GL, 
  playerInput: string,
  resolvedSide: string | null,
): string | null {
  const trimmed = playerInput.trim();
  if (trimmed && self.scriptPlayerSideByName.has(trimmed.toUpperCase())) {
    return self.normalizeControllingPlayerToken(trimmed);
  }
  if (resolvedSide) {
    return self.normalizeControllingPlayerToken(resolvedSide);
  }
  return self.normalizeControllingPlayerToken(trimmed);
}

export function resolveScriptPlayerConditionSelector(self: GL, playerInput: string): {
  normalizedSide: string | null;
  controllingPlayerToken: string | null;
  explicitNamedPlayer: boolean;
} {
  const trimmed = playerInput.trim();
  const explicitNamedPlayer = trimmed.length > 0 && self.scriptPlayerSideByName.has(trimmed.toUpperCase());
  const normalizedSide = resolveScriptPlayerSideFromInput(self, playerInput);
  const controllingPlayerToken = explicitNamedPlayer
    ? self.normalizeControllingPlayerToken(trimmed)
    : resolveScriptControllingPlayerTokenFromInput(self, playerInput, normalizedSide);
  return {
    normalizedSide,
    controllingPlayerToken,
    explicitNamedPlayer,
  };
}

export function resolveScriptWaypointPosition(self: GL, waypointName: string): { x: number; z: number } | null {
  const normalizedWaypointName = waypointName.trim().toUpperCase();
  if (!normalizedWaypointName) {
    return null;
  }
  const waypointNodes = self.loadedMapData?.waypoints?.nodes;
  if (!waypointNodes) {
    return null;
  }
  for (const waypointNode of waypointNodes) {
    if (waypointNode.name.trim().toUpperCase() !== normalizedWaypointName) {
      continue;
    }
    return {
      x: waypointNode.position.x,
      z: waypointNode.position.y,
    };
  }
  return null;
}

export function resolveScriptTriggerAreaByName(self: GL, triggerName: string): {
  triggerIndex: number;
  centerX: number;
  centerZ: number;
  radius: number;
} | null {
  const normalizedTriggerName = triggerName.trim().toUpperCase();
  if (!normalizedTriggerName) {
    return null;
  }
  const triggerIndex = self.mapTriggerRegions.findIndex(
    (region) => region.nameUpper === normalizedTriggerName,
  );
  if (triggerIndex < 0) {
    return null;
  }

  const trigger = self.mapTriggerRegions[triggerIndex]!;
  const centerX = (trigger.minX + trigger.maxX) / 2;
  const centerZ = (trigger.minZ + trigger.maxZ) / 2;
  const halfWidth = (trigger.maxX - trigger.minX) / 2;
  // Source parity: PolygonTrigger::updateBounds currently uses (hi.y + lo.y) / 2.
  const halfHeight = (trigger.maxZ + trigger.minZ) / 2;
  const radius = Math.sqrt((halfWidth * halfWidth) + (halfHeight * halfHeight));
  return {
    triggerIndex,
    centerX,
    centerZ,
    radius,
  };
}

export function getScriptTeamRecord(self: GL, teamName: string): ScriptTeamRecord | null {
  const teamNameUpper = resolveScriptTeamName(self, teamName);
  if (!teamNameUpper) {
    return null;
  }

  // Source parity: ScriptEngine::getTeamNamed prefers the active calling/condition
  // context team when its Team::getName() matches the requested token.
  if (self.scriptCallingTeamNameUpper) {
    const callingTeam = self.scriptTeamsByName.get(self.scriptCallingTeamNameUpper) ?? null;
    if (callingTeam && isScriptTeamNameMatch(self, callingTeam, teamNameUpper)) {
      return callingTeam;
    }
  }
  if (self.scriptConditionTeamNameUpper) {
    const conditionTeam = self.scriptTeamsByName.get(self.scriptConditionTeamNameUpper) ?? null;
    if (conditionTeam && isScriptTeamNameMatch(self, conditionTeam, teamNameUpper)) {
      return conditionTeam;
    }
  }

  const prototypeInstances = getScriptTeamInstancesByPrototypeName(self, teamNameUpper);
  if (prototypeInstances.length > 0) {
    const prototypeRecord = self.scriptTeamsByName.get(teamNameUpper) ?? prototypeInstances[0]!;
    let singleton = prototypeRecord.isSingleton;
    if (prototypeRecord.maxInstances < 2) {
      singleton = true;
    }

    // Source parity: singleton team names resolve to the first active instance.
    if (singleton) {
      for (const team of prototypeInstances) {
        if (team.created || team.memberEntityIds.size > 0) {
          return team;
        }
      }
    }
    return prototypeInstances[0] ?? null;
  }

  return self.scriptTeamsByName.get(teamNameUpper) ?? null;
}

export function getScriptTeamPrototypeRecord(self: GL, teamName: string): ScriptTeamRecord | null {
  const teamNameUpper = resolveScriptTeamName(self, teamName);
  if (!teamNameUpper) {
    return null;
  }
  return self.scriptTeamsByName.get(teamNameUpper) ?? null;
}

export function getScriptTeamMemberEntities(self: GL, team: ScriptTeamRecord): MapEntity[] {
  const entities: MapEntity[] = [];
  for (const entityId of team.memberEntityIds) {
    const entity = self.spawnedEntities.get(entityId);
    if (!entity) {
      continue;
    }
    entities.push(entity);
  }
  return entities;
}

export function isScriptTeamMemberAliveForObjects(self: GL, entity: MapEntity): boolean {
  if (isScriptEntityEffectivelyDead(self, entity) || entity.destroyed) {
    return false;
  }
  if (entity.kindOf.has('PROJECTILE') || entity.kindOf.has('INERT') || entity.kindOf.has('MINE')) {
    return false;
  }
  return true;
}

export function isScriptTeamMemberAliveForUnits(self: GL, entity: MapEntity): boolean {
  if (isScriptEntityEffectivelyDead(self, entity) || entity.destroyed) {
    return false;
  }
  if (entity.kindOf.has('STRUCTURE') || entity.kindOf.has('PROJECTILE') || entity.kindOf.has('MINE')) {
    return false;
  }
  return true;
}

export function resolveScriptTeamControllingSide(self: GL, team: ScriptTeamRecord): string | null {
  if (team.controllingSide) {
    return team.controllingSide;
  }

  let resolvedSide: string | null = null;
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    const entitySide = self.normalizeSide(entity.side);
    if (!entitySide) {
      return null;
    }
    if (resolvedSide === null) {
      resolvedSide = entitySide;
      continue;
    }
    if (resolvedSide !== entitySide) {
      return null;
    }
  }

  return resolvedSide;
}

export function isScriptTeamMemberInsideTrigger(self: GL, entityId: number, triggerIndex: number): boolean {
  return self.scriptTriggerMembershipByEntityId.get(entityId)?.has(triggerIndex) ?? false;
}

export function resolveScriptRelationshipInput(self: GL, input: ScriptRelationshipInput): RelationshipValue | null {
  if (typeof input === 'number') {
    const value = Math.trunc(input);
    if (
      value === RELATIONSHIP_ENEMIES
      || value === RELATIONSHIP_NEUTRAL
      || value === RELATIONSHIP_ALLIES
    ) {
      return value;
    }
    return null;
  }

  const normalized = input.trim().toUpperCase();
  switch (normalized) {
    case 'ENEMY':
    case 'ENEMIES':
    case 'REL_ENEMY':
      return RELATIONSHIP_ENEMIES;
    case 'NEUTRAL':
    case 'REL_NEUTRAL':
      return RELATIONSHIP_NEUTRAL;
    case 'FRIEND':
    case 'FRIENDS':
    case 'ALLY':
    case 'ALLIES':
    case 'REL_FRIEND':
      return RELATIONSHIP_ALLIES;
    default:
      return null;
  }
}

export function isScriptEntityEffectivelyDead(self: GL, entity: MapEntity): boolean {
  return entity.destroyed || entity.slowDeathState !== null || entity.structureCollapseState !== null;
}

export function findScriptRepairDozerForBuilding(self: GL, side: string, building: MapEntity): MapEntity | null {
  let best: MapEntity | null = null;
  let bestDistSqr = Infinity;

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    if (self.normalizeSide(entity.side) !== side) continue;
    if (self.pendingConstructionActions.has(entity.id) || self.pendingRepairActions.has(entity.id)) continue;
    if (!self.canDozerRepairTarget(entity, building, 'AI')) continue;

    const dx = entity.x - building.x;
    const dz = entity.z - building.z;
    const distSqr = dx * dx + dz * dz;
    if (distSqr < bestDistSqr) {
      best = entity;
      bestDistSqr = distSqr;
    }
  }

  return best;
}

export function notifyScriptObjectCreationOrDestruction(self: GL): void {
  self.scriptObjectTopologyVersion += 1;
  self.scriptObjectCountChangedFrame = self.frameCounter;
}

export function clearScriptTriggerTrackingForEntity(self: GL, entityId: number): void {
  self.scriptTriggerMembershipByEntityId.delete(entityId);
  self.scriptTriggerEnteredByEntityId.delete(entityId);
  self.scriptTriggerExitedByEntityId.delete(entityId);
  self.scriptTriggerEnterExitFrameByEntityId.delete(entityId);
}

export function isScriptSequentialEntityIdle(self: GL, entity: MapEntity): boolean {
  return !entity.moving
    && entity.attackTargetEntityId === null
    && entity.guardState === 'NONE'
    && (!entity.specialAbilityState || entity.specialAbilityState.packingState === 'NONE')
    && entity.transportContainerId === null;
}

export function isScriptSequentialTeamIdle(self: GL, team: ScriptTeamRecord): boolean {
  const members = getScriptTeamMemberEntities(self, team).filter((entity) => !entity.destroyed);
  if (members.length === 0) {
    return true;
  }
  return members.every((entity) => isScriptSequentialEntityIdle(self, entity));
}

export function isScriptSequentialTeamDead(self: GL, team: ScriptTeamRecord): boolean {
  for (const entity of getScriptTeamMemberEntities(self, team)) {
    if (!entity.destroyed) {
      return false;
    }
  }
  return true;
}

export function executeScriptRevealMapAtWaypoint(self: GL, 
  waypointName: string,
  radiusToReveal: number,
  playerName: string,
): boolean {
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  if (!waypoint) {
    return false;
  }
  const radius = Number.isFinite(radiusToReveal) ? Math.max(0, radiusToReveal) : 0;

  const targetSide = resolveScriptRevealMapTargetSide(self, playerName);
  if (targetSide) {
    self.setMapRevealAtWaypointForSide(targetSide, waypoint.x, waypoint.z, radius);
    return true;
  }

  for (const side of collectScriptHumanSides(self)) {
    self.setMapRevealAtWaypointForSide(side, waypoint.x, waypoint.z, radius);
  }
  return true;
}

export function executeScriptShroudMapAtWaypoint(self: GL, 
  waypointName: string,
  radiusToShroud: number,
  playerName: string,
): boolean {
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  if (!waypoint) {
    return false;
  }
  const radius = Number.isFinite(radiusToShroud) ? Math.max(0, radiusToShroud) : 0;

  const targetSide = resolveScriptRevealMapTargetSide(self, playerName);
  if (targetSide) {
    self.setMapShroudAtWaypointForSide(targetSide, waypoint.x, waypoint.z, radius);
    return true;
  }

  for (const side of collectScriptHumanSides(self)) {
    self.setMapShroudAtWaypointForSide(side, waypoint.x, waypoint.z, radius);
  }
  return true;
}

export function executeScriptRevealMapEntire(self: GL, playerName: string): boolean {
  const targetSide = resolveScriptRevealMapTargetSide(self, playerName);
  if (targetSide) {
    self.setMapRevealEntireForSide(targetSide);
    return true;
  }

  for (const side of collectScriptHumanSides(self)) {
    self.setMapRevealEntireForSide(side);
  }
  return true;
}

export function executeScriptRevealMapEntirePermanently(self: GL, reveal: boolean, playerName: string): boolean {
  const targetSide = resolveScriptRevealMapTargetSide(self, playerName);
  if (targetSide) {
    self.setMapRevealEntirePermanentlyForSide(targetSide, reveal);
    return true;
  }

  for (const side of collectScriptHumanSides(self)) {
    self.setMapRevealEntirePermanentlyForSide(side, reveal);
  }
  return true;
}

export function executeScriptShroudMapEntire(self: GL, playerName: string): boolean {
  const targetSide = resolveScriptRevealMapTargetSide(self, playerName);
  if (targetSide) {
    self.setMapShroudEntireForSide(targetSide);
    return true;
  }

  for (const side of collectScriptHumanSides(self)) {
    self.setMapShroudEntireForSide(side);
  }
  return true;
}

export function executeScriptRevealMapAtWaypointPermanently(self: GL, 
  waypointName: string,
  radiusToReveal: number,
  side: string,
  lookName: string,
): boolean {
  const waypoint = resolveScriptWaypointPosition(self, waypointName);
  const normalizedSide = self.normalizeSide(side);
  const normalizedLookName = normalizeScriptVariableName(self, lookName);
  if (!waypoint || !normalizedSide || !normalizedLookName) {
    return false;
  }

  const grid = self.fogOfWarGrid;
  if (!grid) {
    return false;
  }

  const playerIndex = self.resolvePlayerIndexForSide(normalizedSide);
  if (playerIndex < 0) {
    return false;
  }

  const radius = Number.isFinite(radiusToReveal) ? Math.max(0, radiusToReveal) : 0;
  const existing = self.scriptNamedMapRevealByName.get(normalizedLookName);
  if (existing?.applied) {
    grid.removeLooker(existing.playerIndex, existing.worldX, existing.worldZ, existing.radius);
  }

  self.scriptNamedMapRevealByName.set(normalizedLookName, {
    revealName: normalizedLookName,
    waypointName,
    playerName: side,
    playerIndex,
    worldX: waypoint.x,
    worldZ: waypoint.z,
    radius,
    applied: false,
  });

  return self.applyNamedScriptMapReveal(normalizedLookName);
}

export function executeScriptUndoRevealMapAtWaypointPermanently(self: GL, lookName: string): boolean {
  const normalizedLookName = normalizeScriptVariableName(self, lookName);
  if (!normalizedLookName || !self.scriptNamedMapRevealByName.has(normalizedLookName)) {
    return false;
  }
  self.undoNamedScriptMapReveal(normalizedLookName);
  return self.removeNamedScriptMapReveal(normalizedLookName);
}

export function clearScriptNamedMapReveals(self: GL): void {
  const grid = self.fogOfWarGrid;
  if (grid) {
    for (const reveal of self.scriptNamedMapRevealByName.values()) {
      if (reveal.applied) {
        grid.removeLooker(reveal.playerIndex, reveal.worldX, reveal.worldZ, reveal.radius);
      }
    }
  }
  self.scriptNamedMapRevealByName.clear();
}

export function resolveScriptRevealMapTargetSide(self: GL, playerName: string): string | null {
  const resolvedSide = resolveScriptPlayerSideFromInput(self, playerName);
  if (!resolvedSide) {
    return null;
  }

  const knownSides = collectScriptKnownSides(self);
  return knownSides.size === 0 || knownSides.has(resolvedSide)
    ? resolvedSide
    : null;
}

export function collectScriptHumanSides(self: GL): string[] {
  const sides: string[] = [];
  for (const side of collectScriptKnownSides(self)) {
    if (self.getSidePlayerType(side) === 'HUMAN') {
      sides.push(side);
    }
  }
  sides.sort();
  return sides;
}

export function collectScriptKnownSides(self: GL): Set<string> {
  const configuredSides = new Set<string>();

  for (const [, side] of self.playerSideByIndex) {
    const normalized = self.normalizeSide(side);
    if (normalized) {
      configuredSides.add(normalized);
    }
  }
  for (const side of self.sidePlayerTypes.keys()) {
    const normalized = self.normalizeSide(side);
    if (normalized) {
      configuredSides.add(normalized);
    }
  }
  if (configuredSides.size > 0) {
    return configuredSides;
  }

  const sides = new Set<string>();

  for (const side of self.sidePlayerIndex.keys()) {
    const normalized = self.normalizeSide(side);
    if (normalized) {
      sides.add(normalized);
    }
  }
  for (const side of self.sideCredits.keys()) {
    const normalized = self.normalizeSide(side);
    if (normalized) {
      sides.add(normalized);
    }
  }
  for (const side of self.sideRankState.keys()) {
    const normalized = self.normalizeSide(side);
    if (normalized) {
      sides.add(normalized);
    }
  }
  for (const entity of self.spawnedEntities.values()) {
    const normalized = self.normalizeSide(entity.side);
    if (normalized) {
      sides.add(normalized);
    }
  }

  return sides;
}

export function setScriptCommandSetButtonOverride(self: GL, 
  commandSetName: string,
  slot: number,
  commandButtonName: string | null,
): void {
  const normalizedCommandSetName = commandSetName.trim().toUpperCase();
  if (!normalizedCommandSetName || slot < 1 || slot > 18) {
    return;
  }
  let slotOverrides = self.commandSetButtonSlotOverrides.get(normalizedCommandSetName);
  if (!slotOverrides) {
    slotOverrides = new Map<number, string | null>();
    self.commandSetButtonSlotOverrides.set(normalizedCommandSetName, slotOverrides);
  }
  if (commandButtonName === null) {
    slotOverrides.set(slot, null);
    return;
  }
  const normalizedCommandButtonName = commandButtonName.trim().toUpperCase();
  slotOverrides.set(slot, normalizedCommandButtonName || null);
}

export function notifyScriptCompletedSpecialPowerOnProjectileFired(self: GL, source: MapEntity): void {
  const profile = source.specialPowerCompletionDieProfiles[0];
  if (!profile) {
    return;
  }

  const normalizedSide = self.normalizeSide(source.side);
  if (!normalizedSide) {
    return;
  }

  const creatorId = Math.trunc(source.specialPowerCompletionCreatorId);
  if (creatorId <= 0) {
    return;
  }

  recordScriptCompletedSpecialPowerEvent(self, 
    normalizedSide,
    profile.specialPowerTemplateName,
    creatorId,
  );
}

export function recordScriptLastDamageInfo(self: GL, target: MapEntity, sourceEntityId: number | null): void {
  const normalizedSourceId = sourceEntityId === null || sourceEntityId === 0
    ? null
    : Math.trunc(sourceEntityId);
  const source = normalizedSourceId === null ? null : self.spawnedEntities.get(normalizedSourceId) ?? null;

  const withinPriorityWindow =
    target.lastDamageInfoFrame === self.frameCounter
    || target.lastDamageInfoFrame === self.frameCounter - 1;
  if (!withinPriorityWindow) {
    applyScriptLastDamageSourceSnapshot(self, target, normalizedSourceId, source);
    return;
  }

  // Source parity: within same/next-frame windows, null/unresolved sources do not
  // overwrite existing last-damage source info.
  if (!source) {
    return;
  }

  const currentSource = target.scriptLastDamageSourceEntityId === null
    ? null
    : self.spawnedEntities.get(target.scriptLastDamageSourceEntityId) ?? null;
  if (!currentSource || self.isPreferredRetaliationSource(source)) {
    applyScriptLastDamageSourceSnapshot(self, target, normalizedSourceId, source);
  }
}

export function applyScriptLastDamageSourceSnapshot(self: GL, 
  target: MapEntity,
  sourceEntityId: number | null,
  source: MapEntity | null,
): void {
  if (sourceEntityId === null || !source) {
    target.scriptLastDamageSourceEntityId = null;
    target.scriptLastDamageSourceTemplateName = null;
    target.scriptLastDamageSourceSide = null;
    target.lastAttackerEntityId = null;
    target.lastDamageInfoFrame = self.frameCounter;
    return;
  }

  target.scriptLastDamageSourceEntityId = sourceEntityId;
  target.scriptLastDamageSourceTemplateName = source.templateName.trim().toUpperCase();
  target.scriptLastDamageSourceSide = self.normalizeSide(source.side);
  target.lastAttackerEntityId = sourceEntityId;
  target.lastDamageInfoFrame = self.frameCounter;
}

export function isScriptSupplySourceSafe(self: GL, 
  normalizedSide: string,
  minSupplies: number,
  ownerToken?: string | null,
): boolean {
  if (self.getSidePlayerType(normalizedSide) !== 'COMPUTER') {
    return true;
  }

  const warehouse = findScriptSupplySourceForSide(self, normalizedSide, minSupplies, ownerToken);
  if (!warehouse) {
    return true;
  }

  const warehouseRadius = self.resolveEntityMajorRadius(warehouse);
  return isScriptLocationSafeForSupplySource(self, normalizedSide, warehouse.x, warehouse.z, warehouseRadius);
}

export function findScriptSupplySourceForSide(self: GL, 
  normalizedSide: string,
  minimumCash: number,
  ownerToken?: string | null,
): MapEntity | null {
  const baseCenter = self.resolveAiBaseCenter(normalizedSide);
  const enemyCenter = resolveScriptEnemyBaseCenter(self, normalizedSide);
  const supplyCenterCloseDistance = 20 * PATHFIND_CELL_SIZE;

  let requiredCash = Math.max(0, Math.trunc(minimumCash));
  do {
    let bestWarehouse: MapEntity | null = null;
    let bestDistSqr = 0;

    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed) continue;
      if (!entity.kindOf.has('STRUCTURE') || !entity.kindOf.has('SUPPLY_SOURCE')) continue;
      if (!entity.supplyWarehouseProfile) continue;

      const warehouseState = self.supplyWarehouseStates.get(entity.id);
      if (!warehouseState) continue;
      const availableCash = warehouseState.currentBoxes * DEFAULT_SUPPLY_BOX_VALUE;
      if (availableCash < requiredCash) continue;

      const entitySide = self.normalizeSide(entity.side);
      if (entitySide && self.getTeamRelationshipBySides(normalizedSide, entitySide) === RELATIONSHIP_ENEMIES) {
        continue;
      }

      // Source parity: skip warehouses that already have an owned cash generator nearby.
      const nearbyRadius = supplyCenterCloseDistance + self.resolveEntityMajorRadius(entity);
      const nearbyRadiusSq = nearbyRadius * nearbyRadius;
      let hasNearbySupplyCenter = false;
      for (const nearby of self.spawnedEntities.values()) {
        if (nearby.destroyed) continue;
        if (!nearby.kindOf.has('CASH_GENERATOR')) continue;
        if (self.normalizeSide(nearby.side) !== normalizedSide) continue;
        if (ownerToken) {
          const nearbyOwnerToken = self.resolveEntityControllingPlayerTokenForAffiliation(nearby);
          if (!nearbyOwnerToken || nearbyOwnerToken !== ownerToken) {
            continue;
          }
        }
        const dx = nearby.x - entity.x;
        const dz = nearby.z - entity.z;
        if (dx * dx + dz * dz <= nearbyRadiusSq) {
          hasNearbySupplyCenter = true;
          break;
        }
      }
      if (hasNearbySupplyCenter) continue;

      const dxBase = baseCenter ? entity.x - baseCenter.x : 0;
      const dzBase = baseCenter ? entity.z - baseCenter.z : 0;
      const distSqr = dxBase * dxBase + dzBase * dzBase;

      if (enemyCenter) {
        const dxEnemy = entity.x - enemyCenter.x;
        const dzEnemy = entity.z - enemyCenter.z;
        const enemyDistSqr = dxEnemy * dxEnemy + dzEnemy * dzEnemy;
        // Source parity: reject expansions that are too close to enemy compared to own base.
        if (distSqr * 0.4 > enemyDistSqr * 0.6) {
          continue;
        }
      }

      if (!bestWarehouse || bestDistSqr > distSqr) {
        bestWarehouse = entity;
        bestDistSqr = distSqr;
      }
    }

    if (bestWarehouse) {
      return bestWarehouse;
    }

    requiredCash = Math.trunc(requiredCash / 2);
  } while (requiredCash > 100);

  return null;
}

export function resolveScriptEnemyBaseCenter(self: GL, normalizedSide: string): { x: number; z: number } | null {
  let bestEnemySide: string | null = null;
  let bestEnemyWeight = Number.NEGATIVE_INFINITY;
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const entitySide = self.normalizeSide(entity.side);
    if (!entitySide || entitySide === normalizedSide) continue;
    if (self.getTeamRelationshipBySides(normalizedSide, entitySide) !== RELATIONSHIP_ENEMIES) continue;
    let weight = 1;
    if (entity.kindOf.has('STRUCTURE')) weight += 3;
    if (entity.kindOf.has('MP_COUNT_FOR_VICTORY')) weight += 2;
    if (weight > bestEnemyWeight) {
      bestEnemyWeight = weight;
      bestEnemySide = entitySide;
    }
  }
  return self.resolveAiBaseCenter(bestEnemySide);
}

export function isScriptLocationSafeForSupplySource(self: GL, 
  normalizedSide: string,
  centerX: number,
  centerZ: number,
  sourceRadius: number,
): boolean {
  const supplyCenterSafeRadius = 250 + sourceRadius;
  for (const enemy of self.spawnedEntities.values()) {
    if (enemy.destroyed) continue;
    const enemySide = self.normalizeSide(enemy.side);
    if (!enemySide) continue;
    if (self.getTeamRelationshipBySides(normalizedSide, enemySide) !== RELATIONSHIP_ENEMIES) {
      continue;
    }
    if (enemy.kindOf.has('HARVESTER') || enemy.kindOf.has('DOZER')) {
      continue;
    }
    if (
      enemy.objectStatusFlags.has('STEALTHED')
      && !enemy.objectStatusFlags.has('DETECTED')
      && !enemy.objectStatusFlags.has('DISGUISED')
    ) {
      continue;
    }

    const dx = enemy.x - centerX;
    const dz = enemy.z - centerZ;
    const range = supplyCenterSafeRadius + self.resolveEntityMajorRadius(enemy);
    if (dx * dx + dz * dz <= range * range) {
      return false;
    }
  }
  return true;
}
