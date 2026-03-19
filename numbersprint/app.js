(function () {
  const SETTINGS_KEY = "numbersprint.settings";
  const HIGH_SCORE_KEY = "numbersprint.highscore";
  const STATUS_WEIGHT = { corrected: 1, skipped: 2, unfinished: 3 };
  const LABELS = {
    fraction: "Fractions",
    decimal: "Decimals",
    percent: "Percentages"
  };
  const NOTES = {
    fraction: "Use a fraction or whole number. Equivalent fractions count.",
    decimal: "Use a decimal number.",
    percent: "Use a percentage, with or without the % sign."
  };
  const FRACTION_DENOMS = [2, 3, 4, 5, 6, 8, 10, 12];
  const TERMINATING_DENOMS = [2, 4, 5, 8, 10, 20, 25, 40, 50, 100];
  const FRIENDLY_PERCENTS = [
    "5",
    "10",
    "12.5",
    "20",
    "25",
    "37.5",
    "40",
    "50",
    "62.5",
    "75",
    "80",
    "125",
    "150"
  ].map(decimalToFraction);
  const $ = function (id) {
    return document.getElementById(id);
  };
  const els = {
    settingsForm: $("settings-form"),
    duration: $("duration"),
    mixSummary: $("mix-summary"),
    bestScore: $("best-score"),
    timeLeft: $("time-left"),
    score: $("score"),
    streak: $("streak"),
    accuracy: $("accuracy"),
    idleState: $("idle-state"),
    gameState: $("game-state"),
    resultsState: $("results-state"),
    roundLabel: $("round-label"),
    topicBadge: $("topic-badge"),
    promptDetail: $("prompt-detail"),
    problemText: $("problem-text"),
    hintCopy: $("hint-copy"),
    answerForm: $("answer-form"),
    answerInput: $("answer-input"),
    skipWord: $("skip-word"),
    endRound: $("end-round"),
    feedback: $("feedback"),
    resultScore: $("result-score"),
    resultAccuracy: $("result-accuracy"),
    resultStreak: $("result-streak"),
    resultMessage: $("result-message"),
    reviewList: $("review-list"),
    playAgain: $("play-again"),
    practiceMissed: $("practice-missed")
  };

  let state = blankState();

  function blankState() {
    return {
      mode: "idle",
      timerId: null,
      current: null,
      pool: null,
      settings: defaults(),
      roundTitle: "Main round",
      score: 0,
      streak: 0,
      bestStreak: 0,
      attempted: 0,
      firstTryCorrect: 0,
      presented: 0,
      reviewItems: [],
      isUntimed: false,
      remainingSeconds: 0,
      endTimeMs: 0
    };
  }

  function defaults() {
    return { duration: "90", families: ["fraction", "decimal", "percent"] };
  }

  function readSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      const families = Array.isArray(parsed.families)
        ? parsed.families.filter(function (family) {
            return LABELS[family];
          })
        : [];
      return {
        duration: String(parsed.duration || "90"),
        families: families.length ? families : defaults().families.slice()
      };
    } catch (error) {
      return defaults();
    }
  }

  function applySettings(settings) {
    els.duration.value = settings.duration;
    document
      .querySelectorAll('input[name="family"]')
      .forEach(function (input) {
        input.checked = settings.families.indexOf(input.value) >= 0;
      });
  }

  function collectSettings() {
    return {
      duration: els.duration.value,
      families: Array.from(
        document.querySelectorAll('input[name="family"]:checked')
      ).map(function (input) {
        return input.value;
      })
    };
  }

  function bindEvents() {
    els.settingsForm.addEventListener("submit", function (event) {
      event.preventDefault();
      startRound();
    });

    els.answerForm.addEventListener("submit", function (event) {
      event.preventDefault();
      submitAnswer(false);
    });

    els.answerInput.addEventListener("input", function () {
      if (
        state.mode === "playing" &&
        state.current &&
        isCorrect(state.current.problem, els.answerInput.value)
      ) {
        submitAnswer(true);
      }
    });

    els.skipWord.addEventListener("click", skipCurrent);
    els.endRound.addEventListener("click", function () {
      if (state.mode === "playing") {
        finishRound(state.isUntimed ? "Round ended." : "Round ended early.");
      }
    });
    els.playAgain.addEventListener("click", function () {
      startRound();
    });
    els.practiceMissed.addEventListener("click", function () {
      if (!state.reviewItems.length) {
        setFeedback("No missed problems are available to practise yet.", "info");
        return;
      }
      startRound(
        state.reviewItems.map(function (item) {
          return cloneProblem(item.problem);
        }),
        "Missed-problem practice"
      );
    });
    document
      .querySelectorAll('input[name="family"]')
      .forEach(function (input) {
        input.addEventListener("change", renderMixSummary);
      });
  }

  function startRound(customProblems, title) {
    const settings = collectSettings();
    if (!customProblems && !settings.families.length) {
      setFeedback("Choose at least one answer style before starting.", "error");
      return;
    }

    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    stopTimer();
    state = blankState();
    state.mode = "playing";
    state.settings = settings;
    state.roundTitle = title || "Main round";
    state.pool =
      Array.isArray(customProblems) && customProblems.length
        ? shuffle(customProblems.map(cloneProblem))
        : null;
    state.isUntimed = settings.duration === "unlimited";
    state.remainingSeconds = state.isUntimed ? 0 : Number(settings.duration);
    state.endTimeMs = state.isUntimed
      ? 0
      : Date.now() + state.remainingSeconds * 1000;

    els.idleState.classList.add("hidden");
    els.resultsState.classList.add("hidden");
    els.gameState.classList.remove("hidden");
    els.answerInput.disabled = false;
    els.skipWord.disabled = false;
    els.endRound.disabled = false;
    updateStats();
    nextProblem();
    state.isUntimed ? renderTime() : runTimer();
    setFeedback(
      state.isUntimed
        ? "Unlimited round started. End the round manually when you are ready."
        : "Round started. Type as soon as you know the answer.",
      "info"
    );
  }

  function nextProblem() {
    const problem = state.pool ? state.pool.pop() : generateProblem(state.settings.families);
    if (!problem) {
      state.current = null;
      finishRound("Practice set complete.");
      return;
    }

    state.current = { problem: problem, attempts: 0 };
    state.presented += 1;
    els.roundLabel.textContent = state.roundTitle;
    els.topicBadge.textContent = LABELS[problem.family];
    els.promptDetail.textContent = "Problem " + state.presented + ". " + problem.note;
    els.problemText.textContent = problem.prompt;
    els.hintCopy.textContent = problem.tip;
    els.answerInput.value = "";
    els.answerInput.focus();
  }

  function submitAnswer(autoSolved) {
    if (state.mode !== "playing" || !state.current) {
      return;
    }

    const raw = normalize(els.answerInput.value);
    if (!raw) {
      setFeedback("Type an answer before you submit.", "error");
      return;
    }

    state.current.attempts += 1;
    if (state.current.attempts === 1) {
      state.attempted += 1;
    }

    if (isCorrect(state.current.problem, raw)) {
      const firstTry = state.current.attempts === 1;
      state.score += 1;
      state.streak = firstTry ? state.streak + 1 : 1;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
      if (firstTry) {
        state.firstTryCorrect += 1;
      } else {
        mergeReview({
          key: state.current.problem.key,
          status: "corrected",
          label: "Needed extra tries",
          detail: reviewText(state.current.problem, "Solved after extra tries."),
          problem: cloneProblem(state.current.problem)
        });
      }
      updateStats();
      setFeedback(
        autoSolved ? "Correct." : "Correct. " + state.current.problem.answerText,
        "success"
      );
      nextProblem();
      return;
    }

    state.streak = 0;
    updateStats();
    setFeedback("Not quite. " + state.current.problem.tip, "error");
    els.answerInput.select();
  }

  function skipCurrent() {
    if (state.mode !== "playing" || !state.current) {
      return;
    }

    if (state.current.attempts === 0) {
      state.attempted += 1;
    }

    state.streak = 0;
    mergeReview({
      key: state.current.problem.key,
      status: "skipped",
      label: "Skipped",
      detail: reviewText(state.current.problem, "Skipped."),
      problem: cloneProblem(state.current.problem)
    });
    updateStats();
    setFeedback("Skipped. " + state.current.problem.answerText, "info");
    nextProblem();
  }

  function finishRound(message) {
    if (state.mode !== "playing") {
      return;
    }

    stopTimer();
    if (state.current && state.current.attempts > 0) {
      mergeReview({
        key: state.current.problem.key,
        status: "unfinished",
        label: "Unfinished",
        detail: reviewText(
          state.current.problem,
          "Time or round ended before it was solved."
        ),
        problem: cloneProblem(state.current.problem)
      });
    }

    state.mode = "results";
    localStorage.setItem(
      HIGH_SCORE_KEY,
      String(Math.max(Number(localStorage.getItem(HIGH_SCORE_KEY) || 0), state.score))
    );
    renderBestScore();
    els.gameState.classList.add("hidden");
    els.resultsState.classList.remove("hidden");
    els.answerInput.disabled = true;
    els.skipWord.disabled = true;
    els.endRound.disabled = true;
    els.resultScore.textContent = String(state.score);
    els.resultAccuracy.textContent = accuracyText();
    els.resultStreak.textContent = String(state.bestStreak);
    els.resultMessage.textContent =
      message +
      " " +
      (state.reviewItems.length
        ? "Review the missed problems below."
        : "No review problems this round.");
    renderReviews();
    updateStats();
  }

  function runTimer() {
    renderTime();
    state.timerId = window.setInterval(function () {
      const seconds = Math.max(0, Math.ceil((state.endTimeMs - Date.now()) / 1000));
      if (seconds !== state.remainingSeconds) {
        state.remainingSeconds = seconds;
        renderTime();
      }
      if (seconds <= 0) {
        finishRound("Time is up.");
      }
    }, 200);
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function renderTime() {
    els.timeLeft.textContent = state.isUntimed ? "Unlimited" : state.remainingSeconds + "s";
  }

  function updateStats() {
    els.score.textContent = String(state.score);
    els.streak.textContent = String(state.streak);
    els.accuracy.textContent = accuracyText();
  }

  function accuracyText() {
    return state.attempted
      ? Math.round((state.firstTryCorrect / state.attempted) * 100) + "%"
      : "0%";
  }

  function renderReviews() {
    els.reviewList.innerHTML = "";
    if (!state.reviewItems.length) {
      const empty = document.createElement("p");
      empty.className = "support-text";
      empty.textContent = "Nothing to review. This round was clean.";
      els.reviewList.appendChild(empty);
      els.practiceMissed.disabled = true;
      return;
    }

    state.reviewItems
      .slice()
      .sort(function (a, b) {
        if (STATUS_WEIGHT[b.status] !== STATUS_WEIGHT[a.status]) {
          return STATUS_WEIGHT[b.status] - STATUS_WEIGHT[a.status];
        }
        return a.problem.prompt.localeCompare(b.problem.prompt);
      })
      .forEach(function (item) {
        const article = document.createElement("article");
        const status = document.createElement("span");
        const heading = document.createElement("h3");
        const detail = document.createElement("p");

        article.className = "review-item";
        status.className = "review-status";
        detail.className = "support-text";
        status.textContent = item.label;
        heading.textContent = item.problem.prompt;
        detail.textContent = item.detail;

        article.appendChild(status);
        article.appendChild(heading);
        article.appendChild(detail);
        els.reviewList.appendChild(article);
      });

    els.practiceMissed.disabled = false;
  }

  function mergeReview(item) {
    const index = state.reviewItems.findIndex(function (entry) {
      return entry.key === item.key;
    });
    if (index < 0 || STATUS_WEIGHT[item.status] >= STATUS_WEIGHT[state.reviewItems[index].status]) {
      index < 0 ? state.reviewItems.push(item) : (state.reviewItems[index] = item);
    }
  }

  function reviewText(problem, prefix) {
    return prefix + " Correct answer: " + problem.answerText + ". " + problem.tip;
  }

  function setFeedback(message, tone) {
    els.feedback.textContent = message;
    els.feedback.className = "feedback " + tone;
  }

  function renderBestScore() {
    const score = Number(localStorage.getItem(HIGH_SCORE_KEY) || 0);
    els.bestScore.textContent = score + (score === 1 ? " correct answer" : " correct answers");
  }

  function renderMixSummary() {
    const names = collectSettings().families.map(function (family) {
      return LABELS[family].toLowerCase();
    });
    els.mixSummary.textContent = !names.length
      ? "Choose at least one answer style."
      : names.length === 1
        ? names[0] + " answers only."
        : names.slice(0, -1).join(", ") + ", and " + names[names.length - 1] + " answers.";
  }

  function cloneProblem(problem) {
    return {
      prompt: problem.prompt,
      family: problem.family,
      mode: problem.mode,
      answer: fraction(problem.answer.n, problem.answer.d),
      answerText: problem.answerText,
      note: problem.note,
      tip: problem.tip,
      key: problem.key
    };
  }

  function generateProblem(families) {
    const generators = [];
    if (families.indexOf("fraction") >= 0) {
      generators.push(genFractionArithmetic, genDecimalToFraction, genPercentToFraction);
    }
    if (families.indexOf("decimal") >= 0) {
      generators.push(genDecimalArithmetic, genFractionToDecimal, genPercentToDecimal);
    }
    if (families.indexOf("percent") >= 0) {
      generators.push(genPercentArithmetic, genFractionToPercent, genDecimalToPercent);
    }
    return generators[randomInt(0, generators.length - 1)]();
  }

  function genFractionArithmetic() {
    const ops = ["+", "-", "x", "/"];
    let left;
    let right;
    let answer;
    let op;
    do {
      op = ops[randomInt(0, ops.length - 1)];
      left = randomProperFraction(FRACTION_DENOMS);
      right = randomProperFraction(FRACTION_DENOMS);
      if (op === "+") {
        answer = add(left, right);
      } else if (op === "-") {
        if (compare(left, right) < 0) {
          const swap = left;
          left = right;
          right = swap;
        }
        answer = subtract(left, right);
      } else if (op === "x") {
        answer = multiply(left, right);
      } else {
        answer = divide(left, right);
      }
    } while (Math.abs(answer.n) > 30 || answer.d > 72);
    return problem(
      formatFraction(left) + " " + op + " " + formatFraction(right),
      "fraction",
      answer,
      NOTES.fraction,
      formatFraction(answer)
    );
  }

  function genDecimalToFraction() {
    const value = randomDecimalFraction();
    return problem(
      formatDecimal(value, true) + " = ? as a fraction",
      "fraction",
      value,
      "Write the decimal over 10, 100, or 1000, then simplify.",
      formatFraction(value)
    );
  }

  function genPercentToFraction() {
    const percent = randomPercent();
    const answer = divide(percent, fraction(100, 1));
    return problem(
      formatPercent(percent) + " = ? as a fraction",
      "fraction",
      answer,
      "Percent means out of 100. Convert, then simplify.",
      formatFraction(answer)
    );
  }

  function genDecimalArithmetic() {
    const ops = ["+", "-", "x", "/"];
    let left;
    let right;
    let answer;
    let op;
    do {
      op = ops[randomInt(0, ops.length - 1)];
      if (op === "/") {
        answer = randomDecimalFraction();
        right = randomDecimalFraction();
        left = multiply(answer, right);
      } else {
        left = randomDecimalFraction();
        right = randomDecimalFraction();
        answer = op === "+" ? add(left, right) : op === "-" ? subtract(compare(left, right) < 0 ? right : left, compare(left, right) < 0 ? left : right) : multiply(left, right);
        if (op === "-" && compare(left, right) < 0) {
          const swap = left;
          left = right;
          right = swap;
        }
      }
    } while (!terminating(answer));
    return problem(
      formatDecimal(left, true) + " " + op + " " + formatDecimal(right, true),
      "decimal",
      answer,
      NOTES.decimal,
      formatDecimal(answer, true)
    );
  }

  function genFractionToDecimal() {
    const value = randomProperFraction(TERMINATING_DENOMS);
    return problem(
      formatFraction(value) + " = ? as a decimal",
      "decimal",
      value,
      "Turn the denominator into tenths, hundredths, or thousandths.",
      formatDecimal(value, true)
    );
  }

  function genPercentToDecimal() {
    const percent = randomPercent();
    const answer = divide(percent, fraction(100, 1));
    return problem(
      formatPercent(percent) + " = ? as a decimal",
      "decimal",
      answer,
      "Move the decimal point two places left.",
      formatDecimal(answer, true)
    );
  }

  function genPercentArithmetic() {
    const ops = ["+", "-", "of"];
    let left;
    let right;
    let answer;
    let op;
    do {
      op = ops[randomInt(0, ops.length - 1)];
      left = randomPercent();
      right = randomPercent();
      if (op === "+") {
        answer = add(left, right);
      } else if (op === "-") {
        if (compare(left, right) < 0) {
          const swap = left;
          left = right;
          right = swap;
        }
        answer = subtract(left, right);
      } else {
        answer = divide(multiply(left, right), fraction(100, 1));
      }
    } while (compare(answer, fraction(0, 1)) === 0);
    return problem(
      op === "of"
        ? formatPercent(left) + " of " + formatPercent(right)
        : formatPercent(left) + " " + op + " " + formatPercent(right),
      "percent",
      answer,
      NOTES.percent,
      formatPercent(answer)
    );
  }

  function genFractionToPercent() {
    const value = randomProperFraction(TERMINATING_DENOMS);
    const answer = multiply(value, fraction(100, 1));
    return problem(
      formatFraction(value) + " = ?%",
      "percent",
      answer,
      "Multiply the fraction by 100.",
      formatPercent(answer)
    );
  }

  function genDecimalToPercent() {
    const value = randomDecimalFraction();
    const answer = multiply(value, fraction(100, 1));
    return problem(
      formatDecimal(value, true) + " = ?%",
      "percent",
      answer,
      "Move the decimal point two places right.",
      formatPercent(answer)
    );
  }

  function problem(prompt, mode, answer, tip, answerText) {
    return {
      prompt: prompt,
      family: mode,
      mode: mode,
      answer: answer,
      answerText: answerText,
      note: NOTES[mode],
      tip: tip,
      key: prompt + " => " + answerText
    };
  }

  function isCorrect(problemItem, raw) {
    const parsed = problemItem.mode === "fraction"
      ? parseFraction(raw)
      : problemItem.mode === "decimal"
        ? parseDecimal(raw)
        : parsePercent(raw);
    return parsed ? equal(parsed, problemItem.answer) : false;
  }

  function normalize(raw) {
    return String(raw || "").trim().replace(/\s+/g, "");
  }

  function parseFraction(raw) {
    raw = normalize(raw);
    if (!/^[-+]?\d+(?:\/[-+]?\d+)?$/.test(raw)) {
      return null;
    }
    if (raw.indexOf("/") < 0) {
      return fraction(Number(raw), 1);
    }
    const parts = raw.split("/");
    return Number(parts[1]) ? fraction(Number(parts[0]), Number(parts[1])) : null;
  }

  function parseDecimal(raw) {
    raw = normalize(raw);
    return /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw) ? decimalToFraction(raw) : null;
  }

  function parsePercent(raw) {
    raw = normalize(raw).replace(/%$/, "");
    return parseDecimal(raw);
  }

  function randomProperFraction(denoms) {
    const d = denoms[randomInt(0, denoms.length - 1)];
    return fraction(randomInt(1, d - 1), d);
  }

  function randomDecimalFraction() {
    const scales = [10, 100, 1000];
    let value;
    do {
      const d = scales[randomInt(0, scales.length - 1)];
      value = fraction(randomInt(1, d * 3), d);
    } while (value.d === 1);
    return value;
  }

  function randomPercent() {
    return FRIENDLY_PERCENTS[randomInt(0, FRIENDLY_PERCENTS.length - 1)];
  }

  function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function fraction(n, d) {
    const sign = d < 0 ? -1 : 1;
    const g = gcd(n, d);
    return { n: (n * sign) / g, d: Math.abs(d) / g };
  }

  function gcd(a, b) {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y) {
      const temp = x % y;
      x = y;
      y = temp;
    }
    return x || 1;
  }

  function add(a, b) {
    return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
  }

  function subtract(a, b) {
    return fraction(a.n * b.d - b.n * a.d, a.d * b.d);
  }

  function multiply(a, b) {
    return fraction(a.n * b.n, a.d * b.d);
  }

  function divide(a, b) {
    return fraction(a.n * b.d, a.d * b.n);
  }

  function compare(a, b) {
    const diff = a.n * b.d - b.n * a.d;
    return diff === 0 ? 0 : diff > 0 ? 1 : -1;
  }

  function equal(a, b) {
    return a.n === b.n && a.d === b.d;
  }

  function terminating(value) {
    let d = value.d;
    while (d % 2 === 0) {
      d /= 2;
    }
    while (d % 5 === 0) {
      d /= 5;
    }
    return d === 1;
  }

  function formatFraction(value) {
    return value.d === 1 ? String(value.n) : value.n + "/" + value.d;
  }

  function formatDecimal(value, forceDecimal) {
    const sign = value.n < 0 ? "-" : "";
    let remainder = Math.abs(value.n);
    const whole = Math.floor(remainder / value.d);
    const digits = [];
    remainder = remainder % value.d;
    while (remainder) {
      remainder *= 10;
      digits.push(Math.floor(remainder / value.d));
      remainder = remainder % value.d;
    }
    if (!digits.length) {
      return forceDecimal ? sign + whole + ".0" : sign + whole;
    }
    while (digits.length > 1 && digits[digits.length - 1] === 0) {
      digits.pop();
    }
    return sign + whole + "." + digits.join("");
  }

  function formatPercent(value) {
    return formatDecimal(value, false) + "%";
  }

  function decimalToFraction(raw) {
    const sign = raw.charAt(0) === "-" ? -1 : 1;
    const clean = raw.replace(/^[-+]/, "");
    const parts = clean.split(".");
    if (parts.length === 1) {
      return fraction(sign * Number(parts[0]), 1);
    }
    const denominator = Math.pow(10, parts[1].length);
    return fraction(sign * Number(parts[0] + parts[1]), denominator);
  }

  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const swapIndex = randomInt(0, i);
      const temp = copy[i];
      copy[i] = copy[swapIndex];
      copy[swapIndex] = temp;
    }
    return copy;
  }

  function initialise() {
    applySettings(readSettings());
    bindEvents();
    renderBestScore();
    renderMixSummary();
    els.timeLeft.textContent = "--";
    updateStats();
    setFeedback("Press Start round when you are ready.", "info");
    els.practiceMissed.disabled = true;
    els.endRound.disabled = true;
  }

  initialise();
})();
