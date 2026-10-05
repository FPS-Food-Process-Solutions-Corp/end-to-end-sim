const WAIT_PHASE = 'Bread: wait for bag to open';

function remapFailure(failure, time) {
  if (!failure) return failure;
  return {
    ...failure,
    time: time(failure.time),
    previous: failure.previous ? {...failure.previous, time: time(failure.previous.time)} : null,
    segment: failure.segment ? {
      ...failure.segment,
      startTime: time(failure.segment.startTime),
      endTime: time(failure.segment.endTime),
    } : failure.segment,
  };
}

// Only add a stationary hold above the bag. Every moving segment keeps its
// original joint path, duration, grasp state and collision-checked geometry.
function scheduleBread(bread, bagReadyTime, parallel) {
  const above = bread.knots.find(k => k.phase === 'Bread: carry above open bag');
  if (bread.pathOK && !above) throw new Error('Bread route is missing its above-bag checkpoint.');
  const startTime = parallel ? 0 : bagReadyTime;
  const wait = parallel && above ? Math.max(0, bagReadyTime - above.time) : 0;
  const map = t => above && t > above.time ? t + wait : t;
  const insertWait = frames => {
    const mapped = frames.map(frame => ({...frame, time: map(frame.time)}));
    if (wait > 0) {
      const index = frames.findIndex(frame => Math.abs(frame.time - above.time) < 1e-7);
      // Failed prefixes that never reached the waiting point must not gain
      // an invented pose or skip the unsolved part of their route.
      if (index >= 0) mapped.splice(index + 1, 0, {
        ...frames[index], time: above.time + wait, phase: WAIT_PHASE,
      });
    }
    return mapped;
  };
  return {
    ...bread,
    frames: insertWait(bread.frames),
    knots: insertWait(bread.knots),
    failure: remapFailure(bread.failure, map),
    searches: bread.searches?.map(search => ({
      ...search, startTime: map(search.startTime), endTime: map(search.endTime),
    })),
    duration: bread.duration + wait,
    startTime,
    endTime: startTime + bread.duration + wait,
    waitForBag: wait,
    insertionStartTime: above ? startTime + above.time + wait : null,
  };
}

export function coordinatePacking(bagResult, breadResult, parallel = false) {
  const open = bagResult.route.knots.find(k => k.phase === 'Pull the bag open');
  const hold = bagResult.route.knots.find(k => k.phase === 'Wait for bun loading');
  if (!open || !hold || hold.time <= open.time)
    throw new Error('Bag route is missing its open-and-hold checkpoints.');
  const bread = scheduleBread(breadResult, open.time, parallel);
  // Keep the fixed suction engaged until placement, settling AND withdrawal
  // have finished. Retain the existing minimum opened-bag dwell.
  const holdEnd = Math.max(hold.time, bread.endTime);
  const shift = holdEnd - hold.time;
  const map = t => t <= open.time ? t : t >= hold.time ? t + shift
    : open.time + (t - open.time) * (holdEnd - open.time) / (hold.time - open.time);
  const serialHoldEnd = Math.max(hold.time, open.time + breadResult.duration);
  const placed = bread.knots.find(k => k.breadState === 'loaded');
  return {
    ...bagResult,
    frames: bagResult.frames.map(frame => ({...frame, time: map(frame.time)})),
    failure: remapFailure(bagResult.failure, map),
    route: {
      ...bagResult.route,
      duration: bagResult.route.duration + shift,
      knots: bagResult.route.knots.map(knot => ({...knot, time: map(knot.time)})),
    },
    bread,
    coordination: {
      parallel,
      bagReadyTime: open.time,
      breadStartTime: bread.startTime,
      insertionStartTime: bread.insertionStartTime,
      bunPlacedTime: placed ? bread.startTime + placed.time : null,
      breadClearTime: bread.endTime,
      bagHoldEndTime: holdEnd,
      breadWait: bread.waitForBag,
      timeSavedBeforeCarry: parallel ? serialHoldEnd - holdEnd : 0,
    },
  };
}
