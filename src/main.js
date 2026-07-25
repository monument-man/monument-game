import "./style.css";

const canvas = document.querySelector(
  "#monument-canvas",
);

const originalImage = document.querySelector(
  "#original-image",
);

const context = canvas.getContext("2d");

const stageLabel = document.querySelector(
  "#stage-label",
);

const vertexLabel = document.querySelector(
  "#vertex-label",
);

const guessForm = document.querySelector(
  "#guess-form",
);

const guessInput = document.querySelector(
  "#guess-input",
);

const submitButton = document.querySelector(
  "#submit-button",
);

const feedbackMessage = document.querySelector(
  "#feedback-message",
);

const completionPanel = document.querySelector(
  "#completion-panel",
);

const completionTitle = document.querySelector(
  "#completion-title",
);

const completionMessage = document.querySelector(
  "#completion-message",
);

const playAgainButton = document.querySelector(
  "#play-again-button",
);

const viewToggleButton = document.querySelector(
  "#view-toggle-button",
);

const statusMessage = document.querySelector(
  "#status-message",
);

if (!context) {
  throw new Error(
    "The browser could not create a Canvas 2D context.",
  );
}

const BASE_URL = import.meta.env.BASE_URL;

const TRANSITION_DURATION_MS = 850;

const REDUCED_MOTION_QUERY = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);

let monumentLibrary = [];
let currentMonument = null;
let currentManifest = null;
let currentStage = null;
let currentStageIndex = 0;

let guessCount = 0;
let gameComplete = false;

let transitionInProgress = false;

let showingOriginalImage = false;

let monumentQueue = [];
let lastPlayedMonumentId = null;


/**
 * Load a JSON file.
 */
async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Could not load ${url}. ` +
      `HTTP status: ${response.status}`,
    );
  }

  return response.json();
}


/**
 * Return the base folder URL for the current monument.
 */
function getMonumentBaseUrl() {
  return (
    `${BASE_URL}monuments/` +
    `${currentMonument.id}/`
  );
}


/**
 * Resize the real canvas pixels to match its
 * displayed CSS size.
 */
function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;

  const targetWidth = Math.max(
    1,
    Math.round(bounds.width * pixelRatio),
  );

  const targetHeight = Math.max(
    1,
    Math.round(bounds.height * pixelRatio),
  );

  if (
    canvas.width !== targetWidth ||
    canvas.height !== targetHeight
  ) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
}


/**
 * Create a vertex lookup table for one stage.
 */
function createVertexMap(stage) {
  return new Map(
    stage.vertices.map(
      (vertex) => [vertex.id, vertex],
    ),
  );
}


/**
 * Calculate the scale and centring needed to draw
 * a stage inside the current canvas.
 */
function getCanvasTransform(stage) {
  resizeCanvas();

  const scale = Math.min(
    canvas.width / stage.width,
    canvas.height / stage.height,
  );

  const renderedWidth =
    stage.width * scale;

  const renderedHeight =
    stage.height * scale;

  return {
    scale,

    offsetX:
      (canvas.width - renderedWidth) / 2,

    offsetY:
      (canvas.height - renderedHeight) / 2,
  };
}


/**
 * Clear the complete canvas.
 */
function clearCanvas() {
  context.clearRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );
}


/**
 * Draw one triangle from coordinate objects.
 *
 * Each point must have:
 *
 * {
 *   x: number,
 *   y: number
 * }
 */
function drawTriangle(
  points,
  colour,
  opacity,
  transform,
) {
  if (
    points.length !== 3 ||
    points.some((point) => !point)
  ) {
    return;
  }

  const [pointA, pointB, pointC] = points;
  const [red, green, blue] = colour;

  context.save();

  context.globalAlpha = Math.max(
    0,
    Math.min(1, opacity),
  );

  context.beginPath();

  context.moveTo(
    transform.offsetX +
      pointA.x * transform.scale,

    transform.offsetY +
      pointA.y * transform.scale,
  );

  context.lineTo(
    transform.offsetX +
      pointB.x * transform.scale,

    transform.offsetY +
      pointB.y * transform.scale,
  );

  context.lineTo(
    transform.offsetX +
      pointC.x * transform.scale,

    transform.offsetY +
      pointC.y * transform.scale,
  );

  context.closePath();

  context.fillStyle =
    `rgb(${red}, ${green}, ${blue})`;

  context.fill();
  context.restore();
}


/**
 * Draw one complete indexed mesh stage.
 */
function drawStage(stage) {
  const verticesById =
    createVertexMap(stage);

  const transform =
    getCanvasTransform(stage);

  clearCanvas();

  for (const triangle of stage.triangles) {
    const points = triangle.vertices.map(
      (vertexId) => (
        verticesById.get(vertexId)
      ),
    );

    if (points.some((point) => !point)) {
      console.warn(
        "Triangle references a missing vertex:",
        triangle,
      );

      continue;
    }

    drawTriangle(
      points,
      triangle.colour,
      1,
      transform,
    );
  }
}


/**
 * Keep a number between zero and one.
 */
function clamp01(value) {
  return Math.max(
    0,
    Math.min(1, value),
  );
}


/**
 * Interpolate between two numbers.
 */
function interpolateNumber(
  start,
  end,
  progress,
) {
  return (
    start +
    (end - start) * progress
  );
}


/**
 * Smooth acceleration and deceleration.
 */
function easeInOutCubic(progress) {
  const value = clamp01(progress);

  if (value < 0.5) {
    return 4 * value * value * value;
  }

  return (
    1 -
    Math.pow(-2 * value + 2, 3) / 2
  );
}


/**
 * Interpolate between two RGB colours.
 */
function interpolateColour(
  startColour,
  endColour,
  progress,
) {
  return startColour.map(
    (startChannel, index) => (
      Math.round(
        interpolateNumber(
          startChannel,
          endColour[index],
          progress,
        ),
      )
    ),
  );
}


/**
 * Produce a triangle identity that does not depend
 * on the order of its three vertex IDs.
 */
function triangleKey(triangle) {
  return [...triangle.vertices]
    .sort((first, second) => (
      first - second
    ))
    .join("-");
}


/**
 * Calculate the centre of several points.
 */
function averagePoint(points) {
  if (points.length === 0) {
    return {
      x: 0,
      y: 0,
    };
  }

  const total = points.reduce(
    (sum, point) => ({
      x: sum.x + point.x,
      y: sum.y + point.y,
    }),
    {
      x: 0,
      y: 0,
    },
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}


/**
 * Calculate an average colour from several triangles.
 */
function averageTriangleColour(
  triangles,
  fallbackColour = [128, 128, 128],
) {
  if (triangles.length === 0) {
    return fallbackColour;
  }

  const totals = triangles.reduce(
    (sum, triangle) => [
      sum[0] + triangle.colour[0],
      sum[1] + triangle.colour[1],
      sum[2] + triangle.colour[2],
    ],
    [0, 0, 0],
  );

  return totals.map(
    (total) => (
      Math.round(
        total / triangles.length,
      )
    ),
  );
}


/**
 * Find the closest newly added vertex to a group
 * of old triangle points.
 */
function findNearestAddedVertex(
  trianglePoints,
  addedVertices,
) {
  const triangleCentre =
    averagePoint(trianglePoints);

  if (addedVertices.length === 0) {
    return triangleCentre;
  }

  let nearestVertex =
    addedVertices[0];

  let nearestDistance = Infinity;

  for (const vertex of addedVertices) {
    const xDifference =
      vertex.x - triangleCentre.x;

    const yDifference =
      vertex.y - triangleCentre.y;

    const distanceSquared =
      xDifference * xDifference +
      yDifference * yDifference;

    if (distanceSquared < nearestDistance) {
      nearestDistance = distanceSquared;
      nearestVertex = vertex;
    }
  }

  return nearestVertex;
}


/**
 * Choose the point from which a new triangle grows.
 *
 * Normally this is the average position of the new
 * vertex or vertices contained by the triangle.
 */
function findAddedTriangleAnchor(
  triangle,
  trianglePoints,
  oldVertexIds,
  newVerticesById,
) {
  const newlyAddedTrianglePoints =
    triangle.vertices
      .filter(
        (vertexId) => (
          !oldVertexIds.has(vertexId)
        ),
      )
      .map(
        (vertexId) => (
          newVerticesById.get(vertexId)
        ),
      )
      .filter(Boolean);

  if (newlyAddedTrianglePoints.length > 0) {
    return averagePoint(
      newlyAddedTrianglePoints,
    );
  }

  return averagePoint(trianglePoints);
}


/**
 * Compare two complete mesh stages.
 */
function buildTransitionData(
  oldStage,
  newStage,
) {
  const oldVerticesById =
    createVertexMap(oldStage);

  const newVerticesById =
    createVertexMap(newStage);

  const oldVertexIds = new Set(
    oldStage.vertices.map(
      (vertex) => vertex.id,
    ),
  );

  const addedVertices =
    newStage.vertices.filter(
      (vertex) => (
        !oldVertexIds.has(vertex.id)
      ),
    );

  const oldTrianglesByKey = new Map(
    oldStage.triangles.map(
      (triangle) => [
        triangleKey(triangle),
        triangle,
      ],
    ),
  );

  const newTrianglesByKey = new Map(
    newStage.triangles.map(
      (triangle) => [
        triangleKey(triangle),
        triangle,
      ],
    ),
  );

  const persistentTriangles = [];
  const removedTriangles = [];
  const addedTriangles = [];

  for (
    const [key, oldTriangle]
    of oldTrianglesByKey
  ) {
    const newTriangle =
      newTrianglesByKey.get(key);

    if (newTriangle) {
      persistentTriangles.push({
        oldTriangle,
        newTriangle,
      });
    } else {
      removedTriangles.push(
        oldTriangle,
      );
    }
  }

  for (
    const [key, newTriangle]
    of newTrianglesByKey
  ) {
    if (!oldTrianglesByKey.has(key)) {
      addedTriangles.push(
        newTriangle,
      );
    }
  }

  const transitionColour =
    averageTriangleColour(
      [
        ...removedTriangles,
        ...addedTriangles,
      ],
    );

  return {
    oldVerticesById,
    newVerticesById,
    oldVertexIds,
    addedVertices,

    persistentTriangles,
    removedTriangles,
    addedTriangles,

    transitionColour,
  };
}


/**
 * Draw one frame between two stages.
 */
function drawTransitionFrame(
  oldStage,
  newStage,
  transitionData,
  progress,
) {
  const easedProgress =
    easeInOutCubic(progress);

  const transform =
    getCanvasTransform(newStage);

  clearCanvas();

  /*
  Persistent triangles stay visible.

  Their coordinates and colours interpolate between
  the old and new versions.
  */
  for (
    const pair
    of transitionData.persistentTriangles
  ) {
    const points =
      pair.oldTriangle.vertices.map(
        (vertexId) => {
          const oldVertex =
            transitionData.oldVerticesById.get(
              vertexId,
            );

          const newVertex =
            transitionData.newVerticesById.get(
              vertexId,
            ) ?? oldVertex;

          if (!oldVertex || !newVertex) {
            return null;
          }

          return {
            x: interpolateNumber(
              oldVertex.x,
              newVertex.x,
              easedProgress,
            ),

            y: interpolateNumber(
              oldVertex.y,
              newVertex.y,
              easedProgress,
            ),
          };
        },
      );

    const colour = interpolateColour(
      pair.oldTriangle.colour,
      pair.newTriangle.colour,
      easedProgress,
    );

    drawTriangle(
      points,
      colour,
      1,
      transform,
    );
  }

  /*
  Removed triangles collapse towards the nearest
  newly added vertex and fade away.
  */
  for (
    const triangle
    of transitionData.removedTriangles
  ) {
    const originalPoints =
      triangle.vertices
        .map(
          (vertexId) => (
            transitionData
              .oldVerticesById
              .get(vertexId)
          ),
        )
        .filter(Boolean);

    if (originalPoints.length !== 3) {
      continue;
    }

    const collapsePoint =
      findNearestAddedVertex(
        originalPoints,
        transitionData.addedVertices,
      );

    const collapsingPoints =
      originalPoints.map(
        (point) => ({
          x: interpolateNumber(
            point.x,
            collapsePoint.x,
            easedProgress,
          ),

          y: interpolateNumber(
            point.y,
            collapsePoint.y,
            easedProgress,
          ),
        }),
      );

    const colour = interpolateColour(
      triangle.colour,
      transitionData.transitionColour,
      easedProgress,
    );

    drawTriangle(
      collapsingPoints,
      colour,
      1 - progress,
      transform,
    );
  }

  /*
  Added triangles begin collapsed around their new
  vertex or vertices, then expand to their final shape.
  */
  for (
    const triangle
    of transitionData.addedTriangles
  ) {
    const finalPoints =
      triangle.vertices
        .map(
          (vertexId) => (
            transitionData
              .newVerticesById
              .get(vertexId)
          ),
        )
        .filter(Boolean);

    if (finalPoints.length !== 3) {
      continue;
    }

    const expansionPoint =
      findAddedTriangleAnchor(
        triangle,
        finalPoints,
        transitionData.oldVertexIds,
        transitionData.newVerticesById,
      );

    const expandingPoints =
      finalPoints.map(
        (point) => ({
          x: interpolateNumber(
            expansionPoint.x,
            point.x,
            easedProgress,
          ),

          y: interpolateNumber(
            expansionPoint.y,
            point.y,
            easedProgress,
          ),
        }),
      );

    const colour = interpolateColour(
      transitionData.transitionColour,
      triangle.colour,
      easedProgress,
    );

    drawTriangle(
      expandingPoints,
      colour,
      progress,
      transform,
    );
  }
}


/**
 * Animate from one complete mesh stage to another.
 */
function animateStageTransition(
  oldStage,
  newStage,
) {
  if (
    REDUCED_MOTION_QUERY.matches ||
    TRANSITION_DURATION_MS <= 0
  ) {
    drawStage(newStage);
    return Promise.resolve();
  }

  const transitionData =
    buildTransitionData(
      oldStage,
      newStage,
    );

  return new Promise((resolve) => {
    let startTime = null;

    function animationFrame(timestamp) {
      if (startTime === null) {
        startTime = timestamp;
      }

      const elapsedTime =
        timestamp - startTime;

      const progress = clamp01(
        elapsedTime /
          TRANSITION_DURATION_MS,
      );

      drawTransitionFrame(
        oldStage,
        newStage,
        transitionData,
        progress,
      );

      if (progress < 1) {
        requestAnimationFrame(
          animationFrame,
        );
      } else {
        drawStage(newStage);
        resolve();
      }
    }

    requestAnimationFrame(
      animationFrame,
    );
  });
}


/**
 * Load and display one stage from the current manifest.
 *
 * When animate is true, the currently displayed mesh
 * transitions into the newly loaded mesh.
 */
async function loadStage(
  stageIndex,
  animate = false,
) {
  if (
    currentManifest === null ||
    stageIndex < 0 ||
    stageIndex >= currentManifest.stages.length
  ) {
    return;
  }

  statusMessage.textContent =
    "Loading mesh stage...";

  const stageInformation =
    currentManifest.stages[stageIndex];

  if (!stageInformation.json) {
    throw new Error(
      "This stage does not contain a JSON path.",
    );
  }

  const stageUrl =
    getMonumentBaseUrl() +
    stageInformation.json;

  const loadedStage =
    await fetchJson(stageUrl);

  if (
    animate &&
    currentStage !== null
  ) {
    transitionInProgress = true;

    statusMessage.textContent =
      "Revealing more detail...";

    try {
      await animateStageTransition(
        currentStage,
        loadedStage,
      );
    } finally {
      transitionInProgress = false;
    }
  }

  currentStage = loadedStage;
  currentStageIndex = stageIndex;

  /*
  Draw the exact completed stage after animation.
  This removes any possible rounding or transparency
  differences from the final animation frame.
  */
  drawStage(currentStage);

  stageLabel.textContent =
    `Stage ${currentStageIndex + 1} ` +
    `of ${currentManifest.stages.length}`;

  vertexLabel.textContent =
    `${currentStage.total_vertices} vertices`;

  statusMessage.textContent =
    `${currentStage.triangle_count} triangles loaded.`;
}


/**
 * Standardise a guess before comparing it.
 */
function normaliseAnswer(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


/**
 * Test whether a submitted guess is correct.
 */
function guessIsCorrect(guess) {
  const acceptedAnswers = [
    currentMonument.name,
    ...(currentMonument.accepted_answers ?? []),
  ];

  const normalisedGuess =
    normaliseAnswer(guess);

  return acceptedAnswers.some(
    (acceptedAnswer) => (
      normaliseAnswer(acceptedAnswer)
      === normalisedGuess
    ),
  );
}


/**
 * Return a shuffled copy of an array.
 *
 * The original array is not modified.
 */
function shuffleArray(items) {
  const shuffledItems = [...items];

  for (
    let currentIndex = shuffledItems.length - 1;
    currentIndex > 0;
    currentIndex -= 1
  ) {
    const randomIndex = Math.floor(
      Math.random() * (currentIndex + 1),
    );

    [
      shuffledItems[currentIndex],
      shuffledItems[randomIndex],
    ] = [
      shuffledItems[randomIndex],
      shuffledItems[currentIndex],
    ];
  }

  return shuffledItems;
}


/**
 * Choose the next monument from a shuffled queue.
 *
 * Every monument is used once before the queue is
 * refilled and shuffled again.
 */
function chooseNextMonument() {
  if (monumentLibrary.length === 0) {
    throw new Error(
      "The monument library is empty.",
    );
  }

  /*
  Refill the queue only after every monument from the
  previous cycle has been used.
  */
  if (monumentQueue.length === 0) {
    monumentQueue = shuffleArray(
      monumentLibrary,
    );

    /*
    Avoid an immediate repeat where one cycle ends and
    the next shuffled cycle begins.

    This is only possible when there is more than one
    monument.
    */
    if (
      monumentQueue.length > 1 &&
      lastPlayedMonumentId !== null &&
      monumentQueue[0].id === lastPlayedMonumentId
    ) {
      const replacementIndex =
        monumentQueue.findIndex(
          (monument) => (
            monument.id !== lastPlayedMonumentId
          ),
        );

      [
        monumentQueue[0],
        monumentQueue[replacementIndex],
      ] = [
        monumentQueue[replacementIndex],
        monumentQueue[0],
      ];
    }
  }

  const nextMonument =
    monumentQueue.shift();

  lastPlayedMonumentId =
    nextMonument.id;

  return nextMonument;
}


/**
 * Return correctly pluralised guess wording.
 */
function describeGuessCount(count) {
  if (count === 1) {
    return "1 guess";
  }

  return `${count} guesses`;
}


/**
 * Switch between the generated polygon mesh
 * and the original prepared PNG.
 */
function toggleMonumentView() {
  showingOriginalImage =
    !showingOriginalImage;

  if (showingOriginalImage) {
    canvas.hidden = true;
    originalImage.hidden = false;

    viewToggleButton.textContent =
      "Show polygon image";
  } else {
    originalImage.hidden = true;
    canvas.hidden = false;

    viewToggleButton.textContent =
      "Show original image";

    /*
    Redraw after making the canvas visible so its
    responsive dimensions are calculated correctly.
    */
    requestAnimationFrame(() => {
      if (currentStage !== null) {
        drawStage(currentStage);
      }
    });
  }
}


/**
 * Finish the current round.
 */
async function finishGame(wasCorrect) {
  gameComplete = true;

  /*
  Reveal the most detailed stage when the round ends.
  */
  const finalStageIndex =
    currentManifest.stages.length - 1;

  if (currentStageIndex !== finalStageIndex) {
    await loadStage(
      finalStageIndex,
      true,
    );
  }

  guessForm.hidden = true;
  completionPanel.hidden = false;

  /*
Load the full prepared PNG and enable the display toggle.
*/
originalImage.src =
  getMonumentBaseUrl() +
  "prepared_input.png";

originalImage.alt =
  `Original image of ${currentMonument.name}`;

showingOriginalImage = false;

canvas.hidden = false;
originalImage.hidden = true;

viewToggleButton.hidden = false;
viewToggleButton.textContent =
  "Show original image";

  if (wasCorrect) {
    completionTitle.textContent =
      "Correct!";

    completionMessage.textContent =
      `You identified ${currentMonument.name} ` +
      `after ${describeGuessCount(guessCount)}.`;
  } else {
    completionTitle.textContent =
      "Round over";

    completionMessage.textContent =
      `The monument was ${currentMonument.name}.`;
  }

  feedbackMessage.textContent = "";
  playAgainButton.focus();
}


/**
 * Handle a submitted guess.
 */
async function handleGuessSubmission(event) {
  event.preventDefault();

  if (
    gameComplete ||
    transitionInProgress
  ) {
    return;
  }

  const submittedGuess =
    guessInput.value.trim();

  if (!submittedGuess) {
    feedbackMessage.textContent =
      "Enter a monument name first.";

    guessInput.focus();
    return;
  }

  submitButton.disabled = true;
  guessInput.disabled = true;

  guessCount += 1;

  try {
    if (guessIsCorrect(submittedGuess)) {
      await finishGame(true);
      return;
    }

    const finalStageIndex =
      currentManifest.stages.length - 1;

    if (currentStageIndex < finalStageIndex) {
      feedbackMessage.textContent =
        "Not quite — revealing more detail.";

      guessInput.value = "";

      await loadStage(
        currentStageIndex + 1,
        true,
      );

      guessInput.disabled = false;
      submitButton.disabled = false;

      guessInput.focus();
    } else {
      await finishGame(false);
    }
  } catch (error) {
    console.error(error);

    feedbackMessage.textContent =
      `Something went wrong: ${error.message}`;

    guessInput.disabled = false;
    submitButton.disabled = false;
  }
}


/**
 * Reset the interface and begin another monument.
 */
async function startNewGame() {
  gameComplete = false;
  guessCount = 0;
  currentStageIndex = 0;
  currentStage = null;

  showingOriginalImage = false;

  canvas.hidden = false;

  originalImage.hidden = true;
  originalImage.src = "";
  originalImage.alt = "";

  viewToggleButton.hidden = true;
  viewToggleButton.textContent =
    "Show original image";

  guessForm.hidden = false;
  completionPanel.hidden = true;

  guessInput.disabled = true;
  submitButton.disabled = true;

  guessInput.value = "";
  feedbackMessage.textContent = "";

  stageLabel.textContent =
    "Loading stage...";

  vertexLabel.textContent =
    "Loading vertices...";

  statusMessage.textContent =
    "Choosing monument...";

  try {
    currentMonument =
      chooseNextMonument();;

    const manifestUrl =
      getMonumentBaseUrl() +
      "manifest.json";

    currentManifest =
      await fetchJson(manifestUrl);

    if (
      !Array.isArray(currentManifest.stages) ||
      currentManifest.stages.length === 0
    ) {
      throw new Error(
        "The monument manifest contains no stages.",
      );
    }

    await loadStage(0);

    guessInput.disabled = false;
    submitButton.disabled = false;

    guessInput.focus();
  } catch (error) {
    console.error(error);

    statusMessage.textContent =
      `Loading failed: ${error.message}`;
  }
}


/**
 * Load the overall monument library and start.
 */
async function initialiseGame() {
  try {
    const libraryData = await fetchJson(
      `${BASE_URL}monuments/index.json`,
    );

    if (!Array.isArray(libraryData.monuments)) {
      throw new Error(
        "The monument index has no monuments array.",
      );
    }

    monumentLibrary =
      libraryData.monuments;

    await startNewGame();
  } catch (error) {
    console.error(error);

    statusMessage.textContent =
      `Loading failed: ${error.message}`;
  }
}


guessForm.addEventListener(
  "submit",
  handleGuessSubmission,
);


playAgainButton.addEventListener(
  "click",
  startNewGame,
);

viewToggleButton.addEventListener(
  "click",
  toggleMonumentView,
);

window.addEventListener(
  "resize",
  () => {
    if (currentStage !== null) {
      drawStage(currentStage);
    }
  },
);


initialiseGame();