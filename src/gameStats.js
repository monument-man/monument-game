import {
  supabase,
} from "./supabase.js";

let currentRoundId = null;
let roundStartedAt = null;

/**
 * Begin tracking a newly displayed monument.
 */
export function beginTrackedRound(
  monumentId,
  gameMode = "all_monuments",
) {
  currentRoundId =
    crypto.randomUUID();

  roundStartedAt =
    performance.now();

  void recordEvent({
    event_type: "round_started",
    round_id: currentRoundId,
    monument_id: monumentId,
    game_mode: gameMode,
  });

  return currentRoundId;
}


/**
 * Record the outcome of the current round.
 */
export function finishTrackedRound({
  monumentId,
  solved,
  guessCount,
  stageReached,
  gameMode = "all_monuments",
}) {
  if (
    currentRoundId === null ||
    roundStartedAt === null
  ) {
    return;
  }

  const durationMs = Math.round(
    performance.now() -
    roundStartedAt,
  );

  void recordEvent({
    event_type: "round_finished",
    round_id: currentRoundId,
    monument_id: monumentId,
    solved,
    guess_count: guessCount,
    stage_reached: stageReached,
    duration_ms: durationMs,
    game_mode: gameMode,
  });

  currentRoundId = null;
  roundStartedAt = null;
}


/**
 * Send an event without interrupting the game
 * if the statistics service is unavailable.
 */
async function recordEvent(event) {
  try {
    const {
      error,
    } = await supabase
      .from("game_events")
      .insert(event);

    if (error) {
      console.error(
        "Could not record game statistics:",
        error,
      );
    }
  } catch (error) {
    console.error(
      "Statistics request failed:",
      error,
    );
  }
}