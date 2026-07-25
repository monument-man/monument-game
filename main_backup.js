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

let monumentLibrary = [];
let currentMonument = null;
let currentManifest = null;
let currentStage = null;
let currentStageIndex = 0;

let guessCount = 0;
let gameComplete = false;

let showingOriginalImage = false;

let previousMonumentId = null;


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
 * Draw one indexed mesh stage.
 */
function drawStage(stage) {
  resizeCanvas();

  context.clearRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const verticesById = new Map(
    stage.vertices.map(
      (vertex) => [vertex.id, vertex],
    ),
  );

  const scale = Math.min(
    canvas.width / stage.width,
    canvas.height / stage.height,
  );

  const renderedWidth =
    stage.width * scale;

  const renderedHeight =
    stage.height * scale;

  const offsetX =
    (canvas.width - renderedWidth) / 2;

  const offsetY =
    (canvas.height - renderedHeight) / 2;

  for (const triangle of stage.triangles) {
    const points = triangle.vertices.map(
      (vertexId) => verticesById.get(vertexId),
    );

    if (points.some((point) => !point)) {
      console.warn(
        "Triangle references a missing vertex:",
        triangle,
      );

      continue;
    }

    const [pointA, pointB, pointC] = points;
    const [red, green, blue] = triangle.colour;

    context.beginPath();

    context.moveTo(
      offsetX + pointA.x * scale,
      offsetY + pointA.y * scale,
    );

    context.lineTo(
      offsetX + pointB.x * scale,
      offsetY + pointB.y * scale,
    );

    context.lineTo(
      offsetX + pointC.x * scale,
      offsetY + pointC.y * scale,
    );

    context.closePath();

    context.fillStyle =
      `rgb(${red}, ${green}, ${blue})`;

    context.fill();
  }
}


/**
 * Load and display one stage from the current manifest.
 */
async function loadStage(stageIndex) {
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

  currentStage = await fetchJson(stageUrl);
  currentStageIndex = stageIndex;

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
 * Choose a monument at random.

 * When more than one exists, avoid immediately
 * repeating the previous monument.
 */
function chooseRandomMonument() {
  if (monumentLibrary.length === 0) {
    throw new Error(
      "The monument library is empty.",
    );
  }

  let availableMonuments =
    monumentLibrary;

  if (
    monumentLibrary.length > 1 &&
    previousMonumentId !== null
  ) {
    availableMonuments =
      monumentLibrary.filter(
        (monument) => (
          monument.id !== previousMonumentId
        ),
      );
  }

  const randomIndex = Math.floor(
    Math.random() * availableMonuments.length,
  );

  return availableMonuments[randomIndex];
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
    await loadStage(finalStageIndex);
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

  if (gameComplete) {
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
      chooseRandomMonument();

    previousMonumentId =
      currentMonument.id;

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