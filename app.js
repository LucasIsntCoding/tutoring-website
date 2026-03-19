(function () {
  const SETTINGS_KEY = "spellsprint.settings";
  const HIGH_SCORE_KEY = "spellsprint.highscore";
  const STATUS_WEIGHT = {
    corrected: 1,
    skipped: 2,
    unfinished: 3
  };
  const VOICE_PROFILES = [
    {
      value: "profile:en-AU",
      label: "Australian English",
      lang: "en-AU"
    },
    {
      value: "profile:en-GB",
      label: "British English",
      lang: "en-GB"
    },
    {
      value: "profile:en-US",
      label: "American English",
      lang: "en-US"
    }
  ];
  const difficultyNames = {
    beginner: "Beginner",
    intermediate: "Intermediate",
    advanced: "Advanced"
  };

  const words = Array.isArray(window.SPELLSPRINT_WORDS)
    ? window.SPELLSPRINT_WORDS.slice()
    : [];

  const els = {
    settingsForm: document.getElementById("settings-form"),
    duration: document.getElementById("duration"),
    autoPronounce: document.getElementById("auto-pronounce"),
    autoHint: document.getElementById("auto-hint"),
    voiceRate: document.getElementById("voice-rate"),
    voiceRateValue: document.getElementById("voice-rate-value"),
    voiceChoice: document.getElementById("voice-choice"),
    voiceStatus: document.getElementById("voice-status"),
    wordBankSize: document.getElementById("word-bank-size"),
    bestScore: document.getElementById("best-score"),
    timeLeft: document.getElementById("time-left"),
    score: document.getElementById("score"),
    streak: document.getElementById("streak"),
    accuracy: document.getElementById("accuracy"),
    idleState: document.getElementById("idle-state"),
    gameState: document.getElementById("game-state"),
    resultsState: document.getElementById("results-state"),
    roundLabel: document.getElementById("round-label"),
    difficultyBadge: document.getElementById("difficulty-badge"),
    promptDetail: document.getElementById("prompt-detail"),
    playWord: document.getElementById("play-word"),
    playHint: document.getElementById("play-hint"),
    hintCopy: document.getElementById("hint-copy"),
    answerForm: document.getElementById("answer-form"),
    answerInput: document.getElementById("answer-input"),
    skipWord: document.getElementById("skip-word"),
    endRound: document.getElementById("end-round"),
    feedback: document.getElementById("feedback"),
    resultScore: document.getElementById("result-score"),
    resultAccuracy: document.getElementById("result-accuracy"),
    resultStreak: document.getElementById("result-streak"),
    resultMessage: document.getElementById("result-message"),
    reviewList: document.getElementById("review-list"),
    playAgain: document.getElementById("play-again"),
    practiceMissed: document.getElementById("practice-missed")
  };

  let state = createEmptyState();

  function createEmptyState() {
    return {
      mode: "idle",
      timerId: null,
      roundBank: [],
      pool: [],
      currentWord: null,
      roundTitle: "Main round",
      score: 0,
      streak: 0,
      bestStreak: 0,
      wordsAttempted: 0,
      wordsPresented: 0,
      firstTryCorrect: 0,
      reviewItems: [],
      isUntimed: false,
      remainingSeconds: 0,
      endTimeMs: 0
    };
  }

  function defaultSettings() {
    return {
      duration: "90",
      autoPronounce: true,
      autoHint: true,
      voiceRate: 0.9,
      voiceChoice: "profile:en-AU",
      difficulties: ["beginner", "intermediate"]
    };
  }

  function readSettings() {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        return defaultSettings();
      }

      const parsed = JSON.parse(raw);
      return {
        duration: String(parsed.duration || "90"),
        autoPronounce: parsed.autoPronounce !== false,
        autoHint: parsed.autoHint !== false,
        voiceRate: clamp(Number(parsed.voiceRate) || 0.9, 0.75, 1.1),
        voiceChoice:
          typeof parsed.voiceChoice === "string"
            ? parsed.voiceChoice
            : "profile:en-AU",
        difficulties: Array.isArray(parsed.difficulties)
          ? parsed.difficulties
          : ["beginner", "intermediate"]
      };
    } catch (error) {
      return defaultSettings();
    }
  }

  function writeSettings(settings) {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function readBestScore() {
    return Number(window.localStorage.getItem(HIGH_SCORE_KEY) || 0);
  }

  function writeBestScore(score) {
    window.localStorage.setItem(HIGH_SCORE_KEY, String(score));
  }

  function applySettingsToForm(settings) {
    els.duration.value = settings.duration;
    els.autoPronounce.checked = settings.autoPronounce;
    els.autoHint.checked = settings.autoHint;
    els.voiceRate.value = String(settings.voiceRate);
    els.voiceRateValue.textContent = Number(settings.voiceRate).toFixed(2) + "x";
    if (
      Array.from(els.voiceChoice.options).some(function (option) {
        return option.value === settings.voiceChoice;
      })
    ) {
      els.voiceChoice.value = settings.voiceChoice;
    } else {
      els.voiceChoice.value = defaultSettings().voiceChoice;
    }

    document
      .querySelectorAll('input[name="difficulty"]')
      .forEach(function (input) {
        input.checked = settings.difficulties.indexOf(input.value) >= 0;
      });
  }

  function collectSettingsFromForm() {
    const difficulties = Array.from(
      document.querySelectorAll('input[name="difficulty"]:checked')
    ).map(function (input) {
      return input.value;
    });

    return {
      duration: els.duration.value,
      autoPronounce: els.autoPronounce.checked,
      autoHint: els.autoHint.checked,
      voiceRate: clamp(Number(els.voiceRate.value) || 0.9, 0.75, 1.1),
      voiceChoice: els.voiceChoice.value,
      difficulties: difficulties
    };
  }

  function bindEvents() {
    els.settingsForm.addEventListener("submit", function (event) {
      event.preventDefault();
      startRound();
    });

    els.answerForm.addEventListener("submit", function (event) {
      event.preventDefault();
      submitAnswer();
    });

    els.skipWord.addEventListener("click", function () {
      skipCurrentWord();
    });

    els.endRound.addEventListener("click", function () {
      if (state.mode !== "playing") {
        return;
      }

      finishRound(state.isUntimed ? "Round ended." : "Round ended early.");
    });

    els.playWord.addEventListener("click", function () {
      speakCurrentWord();
    });

    els.playHint.addEventListener("click", function () {
      revealHint();
      speakHint();
    });

    els.playAgain.addEventListener("click", function () {
      startRound();
    });

    els.practiceMissed.addEventListener("click", function () {
      if (!state.reviewItems.length) {
        setFeedback("No missed words are available to practise yet.", "info");
        return;
      }

      const customPool = state.reviewItems.map(function (item) {
        return item.sourceWord;
      });

      startRound(customPool, "Missed-word practice");
    });

    els.voiceRate.addEventListener("input", function () {
      els.voiceRateValue.textContent =
        Number(els.voiceRate.value).toFixed(2) + "x";
    });

    els.voiceChoice.addEventListener("change", function () {
      updateVoiceStatus();
    });

    if ("speechSynthesis" in window) {
      if (typeof window.speechSynthesis.addEventListener === "function") {
        window.speechSynthesis.addEventListener(
          "voiceschanged",
          refreshVoiceChoices
        );
      }

      if ("onvoiceschanged" in window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = refreshVoiceChoices;
      }
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function startRound(customPool, title) {
    const settings = collectSettingsFromForm();
    if (!customPool && !settings.difficulties.length) {
      setFeedback("Choose at least one difficulty before starting.", "error");
      return;
    }

    const sourcePool = Array.isArray(customPool) && customPool.length
      ? customPool.slice()
      : words.filter(function (entry) {
          return settings.difficulties.indexOf(entry.difficulty) >= 0;
        });

    if (!sourcePool.length) {
      setFeedback("No words are available for that selection.", "error");
      return;
    }

    writeSettings(settings);
    stopRoundTimer();
    stopSpeaking();

    state = createEmptyState();
    state.mode = "playing";
    state.roundTitle = title || "Main round";
    state.roundBank = sourcePool.slice();
    state.pool = shuffle(sourcePool.slice());
    state.isUntimed = settings.duration === "unlimited";
    state.remainingSeconds = state.isUntimed ? 0 : Number(settings.duration);
    state.endTimeMs = state.isUntimed
      ? 0
      : Date.now() + state.remainingSeconds * 1000;

    els.idleState.classList.add("hidden");
    els.resultsState.classList.add("hidden");
    els.gameState.classList.remove("hidden");
    els.playHint.disabled = false;
    els.playWord.disabled = false;
    els.skipWord.disabled = false;
    els.endRound.disabled = false;
    els.answerInput.disabled = false;

    updateStatusCards();
    drawNextWord();
    if (state.isUntimed) {
      renderTime();
    } else {
      runRoundTimer();
    }
    setFeedback(
      state.isUntimed
        ? "Untimed round started. End the round manually when you are ready."
        : "Round started. Listen carefully and type the spelling.",
      "info"
    );
  }

  function runRoundTimer() {
    renderTime();
    state.timerId = window.setInterval(function () {
      const secondsLeft = Math.max(
        0,
        Math.ceil((state.endTimeMs - Date.now()) / 1000)
      );

      if (secondsLeft !== state.remainingSeconds) {
        state.remainingSeconds = secondsLeft;
        renderTime();
      }

      if (secondsLeft <= 0) {
        finishRound("Time is up.");
      }
    }, 200);
  }

  function stopRoundTimer() {
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function renderTime() {
    els.timeLeft.textContent = state.isUntimed
      ? "Untimed"
      : state.remainingSeconds + "s";
  }

  function drawNextWord() {
    if (!state.pool.length) {
      state.pool = shuffle(state.roundBank.slice());
    }

    const nextWord = state.pool.pop();
    state.currentWord = {
      source: nextWord,
      attempts: 0,
      hintVisible: false
    };
    state.wordsPresented += 1;

    els.roundLabel.textContent = state.roundTitle;
    els.difficultyBadge.textContent = difficultyNames[nextWord.difficulty];
    els.promptDetail.textContent =
      "Word " +
      state.wordsPresented +
      " of the round. " +
      nextWord.word.length +
      " letters.";
    els.hintCopy.textContent =
      "Definition and context will appear here after a mistake, or when you press Hear hint.";
    els.answerInput.value = "";
    els.answerInput.focus();

    if (collectSettingsFromForm().autoPronounce) {
      window.setTimeout(speakCurrentWord, 160);
    }
  }

  function submitAnswer() {
    if (state.mode !== "playing" || !state.currentWord) {
      return;
    }

    const guess = normalizeWord(els.answerInput.value);
    if (!guess) {
      setFeedback("Type a spelling before you submit.", "error");
      return;
    }

    const answer = state.currentWord.source.word;
    state.currentWord.attempts += 1;

    if (state.currentWord.attempts === 1) {
      state.wordsAttempted += 1;
    }

    if (guess === normalizeWord(answer)) {
      const solvedOnFirstTry = state.currentWord.attempts === 1;

      state.score += 1;
      state.streak = solvedOnFirstTry ? state.streak + 1 : 1;
      state.bestStreak = Math.max(state.bestStreak, state.streak);

      if (solvedOnFirstTry) {
        state.firstTryCorrect += 1;
      } else {
        mergeReviewItem({
          key: answer.toLowerCase(),
          status: "corrected",
          label: "Needed extra tries",
          detail:
            "Correct answer: " +
            answer +
            ". Definition: " +
            state.currentWord.source.definition +
            " Context: " +
            state.currentWord.source.context,
          sourceWord: state.currentWord.source
        });
      }

      updateStatusCards();
      setFeedback("Correct. Keep moving.", "success");
      drawNextWord();
      return;
    }

    state.streak = 0;
    updateStatusCards();
    setFeedback("Not quite. Try again or use the hint.", "error");

    if (collectSettingsFromForm().autoHint) {
      revealHint();
    }

    els.answerInput.select();
  }

  function skipCurrentWord() {
    if (state.mode !== "playing" || !state.currentWord) {
      return;
    }

    if (state.currentWord.attempts === 0) {
      state.wordsAttempted += 1;
    }

    state.streak = 0;
    mergeReviewItem({
      key: state.currentWord.source.word.toLowerCase(),
      status: "skipped",
      label: "Skipped",
      detail:
        "Correct answer: " +
        state.currentWord.source.word +
        ". Definition: " +
        state.currentWord.source.definition +
        " Context: " +
        state.currentWord.source.context,
      sourceWord: state.currentWord.source
    });

    updateStatusCards();
    setFeedback(
      "Skipped. The correct spelling was " + state.currentWord.source.word + ".",
      "info"
    );
    drawNextWord();
  }

  function finishRound(message) {
    if (state.mode !== "playing") {
      return;
    }

    stopRoundTimer();
    stopSpeaking();

    if (state.currentWord && state.currentWord.attempts > 0) {
      mergeReviewItem({
        key: state.currentWord.source.word.toLowerCase(),
        status: "unfinished",
        label: "Unfinished",
        detail:
          "Correct answer: " +
          state.currentWord.source.word +
          ". Definition: " +
          state.currentWord.source.definition +
          " Context: " +
          state.currentWord.source.context,
        sourceWord: state.currentWord.source
      });
    }

    state.mode = "results";
    writeBestScore(Math.max(readBestScore(), state.score));
    renderBestScore();

    els.gameState.classList.add("hidden");
    els.idleState.classList.add("hidden");
    els.resultsState.classList.remove("hidden");
    els.playHint.disabled = true;
    els.playWord.disabled = true;
    els.skipWord.disabled = true;
    els.endRound.disabled = true;
    els.answerInput.disabled = true;

    els.resultScore.textContent = String(state.score);
    els.resultAccuracy.textContent = getAccuracyText();
    els.resultStreak.textContent = String(state.bestStreak);
    els.resultMessage.textContent =
      message +
      " " +
      (state.reviewItems.length
        ? "Review the missed words below."
        : "No review words this round.");

    renderReviewList();
    updateStatusCards();
  }

  function updateStatusCards() {
    els.score.textContent = String(state.score);
    els.streak.textContent = String(state.streak);
    els.accuracy.textContent = getAccuracyText();
  }

  function getAccuracyText() {
    if (!state.wordsAttempted) {
      return "0%";
    }

    return Math.round((state.firstTryCorrect / state.wordsAttempted) * 100) + "%";
  }

  function renderReviewList() {
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
      .sort(function (left, right) {
        if (STATUS_WEIGHT[right.status] !== STATUS_WEIGHT[left.status]) {
          return STATUS_WEIGHT[right.status] - STATUS_WEIGHT[left.status];
        }
        return left.sourceWord.word.localeCompare(right.sourceWord.word);
      })
      .forEach(function (item) {
        const article = document.createElement("article");
        article.className = "review-item";

        const status = document.createElement("span");
        status.className = "review-status";
        status.textContent = item.label;
        article.appendChild(status);

        const heading = document.createElement("h3");
        heading.textContent = item.sourceWord.word;
        article.appendChild(heading);

        const detail = document.createElement("p");
        detail.className = "support-text";
        detail.textContent = item.detail;
        article.appendChild(detail);

        const replayButton = document.createElement("button");
        replayButton.type = "button";
        replayButton.className = "secondary-button";
        replayButton.textContent = "Play word";
        replayButton.addEventListener("click", function () {
          speakText(item.sourceWord.word);
        });
        article.appendChild(replayButton);

        els.reviewList.appendChild(article);
      });

    els.practiceMissed.disabled = false;
  }

  function mergeReviewItem(item) {
    const existingIndex = state.reviewItems.findIndex(function (entry) {
      return entry.key === item.key;
    });

    if (existingIndex < 0) {
      state.reviewItems.push(item);
      return;
    }

    if (
      STATUS_WEIGHT[item.status] >=
      STATUS_WEIGHT[state.reviewItems[existingIndex].status]
    ) {
      state.reviewItems[existingIndex] = item;
    }
  }

  function revealHint() {
    if (!state.currentWord) {
      return;
    }

    state.currentWord.hintVisible = true;
    els.hintCopy.textContent =
      "Definition: " +
      state.currentWord.source.definition +
      " Context: " +
      state.currentWord.source.context;
  }

  function speakCurrentWord() {
    if (!state.currentWord) {
      return;
    }

    speakText("Spell the word " + state.currentWord.source.word + ".");
  }

  function speakHint() {
    if (!state.currentWord) {
      return;
    }

    speakText(
      "Definition: " +
        state.currentWord.source.definition +
        " Context: " +
        state.currentWord.source.context
    );
  }

  function stopSpeaking() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function speakText(text) {
    if (!("speechSynthesis" in window)) {
      updateVoiceStatus();
      return;
    }

    const utterance = new window.SpeechSynthesisUtterance(text);
    const voice = getSelectedVoice();

    if (!voice) {
      updateVoiceStatus();
      return;
    }

    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = clamp(Number(els.voiceRate.value) || 0.9, 0.75, 1.1);
    utterance.pitch = 1;
    stopSpeaking();
    window.speechSynthesis.speak(utterance);
  }

  function getCompatibleVoices() {
    if (!("speechSynthesis" in window)) {
      return [];
    }

    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) {
      return [];
    }

    return voices.filter(function (voice) {
      return (
        voice.lang &&
        voice.lang.indexOf("en") === 0 &&
        !/microsoft james/i.test(voice.name)
      );
    });
  }

  function buildVoiceValue(voice) {
    return "voice:" + voice.name + "|" + voice.lang;
  }

  function findVoiceByValue(value) {
    if (!value || value.indexOf("voice:") !== 0) {
      return null;
    }

    const encoded = value.slice("voice:".length);
    const separatorIndex = encoded.lastIndexOf("|");
    if (separatorIndex < 0) {
      return null;
    }

    const name = encoded.slice(0, separatorIndex);
    const lang = encoded.slice(separatorIndex + 1);

    return (
      getCompatibleVoices().find(function (voice) {
        return voice.name === name && voice.lang === lang;
      }) || null
    );
  }

  function getBestVoiceForLang(lang) {
    const voices = getCompatibleVoices();
    if (!voices.length) {
      return null;
    }

    return (
      voices.find(function (voice) {
        return voice.lang === lang;
      }) ||
      voices.find(function (voice) {
        return voice.lang === "en-AU";
      }) ||
      voices.find(function (voice) {
        return voice.lang === "en-GB";
      }) ||
      voices.find(function (voice) {
        return voice.lang === "en-US";
      }) ||
      voices.find(function (voice) {
        return voice.lang && voice.lang.indexOf("en") === 0;
      }) ||
      null
    );
  }

  function getSelectedVoice() {
    const selected = els.voiceChoice.value;
    if (selected.indexOf("voice:") === 0) {
      return findVoiceByValue(selected);
    }

    if (selected.indexOf("profile:") === 0) {
      return getBestVoiceForLang(selected.slice("profile:".length));
    }

    return getBestVoiceForLang("en-AU");
  }

  function refreshVoiceChoices() {
    const previousValue =
      els.voiceChoice.value || defaultSettings().voiceChoice;
    const compatibleVoices = getCompatibleVoices()
      .slice()
      .sort(function (left, right) {
        if (left.lang !== right.lang) {
          return left.lang.localeCompare(right.lang);
        }
        return left.name.localeCompare(right.name);
      });

    els.voiceChoice.innerHTML = "";

    VOICE_PROFILES.forEach(function (profile) {
      const option = document.createElement("option");
      option.value = profile.value;
      option.textContent = profile.label;
      els.voiceChoice.appendChild(option);
    });

    compatibleVoices.forEach(function (voice) {
      const option = document.createElement("option");
      option.value = buildVoiceValue(voice);
      option.textContent = voice.name + " (" + voice.lang + ")";
      els.voiceChoice.appendChild(option);
    });

    const availableValues = Array.from(els.voiceChoice.options).map(function (item) {
      return item.value;
    });

    els.voiceChoice.value =
      availableValues.indexOf(previousValue) >= 0
        ? previousValue
        : defaultSettings().voiceChoice;

    updateVoiceStatus();
  }

  function updateVoiceStatus() {
    if (!("speechSynthesis" in window)) {
      els.voiceStatus.textContent =
        "This browser does not expose speech synthesis. The game still works, but audio playback is unavailable.";
      return;
    }

    const rawVoices = window.speechSynthesis.getVoices();
    const compatibleVoices = getCompatibleVoices();
    const voice = getSelectedVoice();

    if (!rawVoices.length) {
      els.voiceStatus.textContent =
        "Speech synthesis is available, but the browser has not finished loading its voice list yet.";
      return;
    }

    if (!compatibleVoices.length) {
      els.voiceStatus.textContent =
        "Speech synthesis is available, but no compatible English voices were found after excluding Microsoft James.";
      return;
    }

    els.voiceStatus.textContent =
      compatibleVoices.length +
      " compatible English voices found. Current selection: " +
      (voice ? voice.name + " (" + voice.lang + ")" : "profile fallback") +
      ". Microsoft James is excluded.";
  }

  function setFeedback(message, tone) {
    els.feedback.textContent = message;
    els.feedback.className = "feedback " + (tone || "info");
  }

  function normalizeWord(text) {
    return String(text || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "");
  }

  function shuffle(list) {
    const cloned = list.slice();
    for (let index = cloned.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const temp = cloned[index];
      cloned[index] = cloned[swapIndex];
      cloned[swapIndex] = temp;
    }
    return cloned;
  }

  function renderBestScore() {
    const score = readBestScore();
    els.bestScore.textContent =
      score + (score === 1 ? " correct word" : " correct words");
  }

  function renderWordBankSize() {
    els.wordBankSize.textContent =
      words.length + (words.length === 1 ? " word" : " words");
  }

  function initialise() {
    const settings = readSettings();
    refreshVoiceChoices();
    applySettingsToForm(settings);
    bindEvents();
    renderBestScore();
    renderWordBankSize();
    updateVoiceStatus();
    els.timeLeft.textContent = "--";
    updateStatusCards();
    setFeedback("Press Start round when you are ready.", "info");
    els.practiceMissed.disabled = true;
    els.endRound.disabled = true;
  }

  initialise();
})();
