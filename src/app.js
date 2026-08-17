import {
  FIELD_DEFS,
  TAG_TYPES,
  MIN_LENGTH,
  SPECIFICITY_HINT_MESSAGE,
  validateField,
  detectAmbiguousExpressions,
  canProceedFromStep1,
  createTag,
  getScaffoldingHints,
  requestFeedback,
  structureProblem,
  formatAsPrompt,
  computeFulfillment,
  hasSpecificityCue,
  getFieldExample,
} from './problemDefinition.js';

const state = {
  fieldValues: Object.fromEntries(FIELD_DEFS.map(({ id }) => [id, ''])),
  tags: [],
  selection: null, // { text, fieldId }
};

const forceFeedbackError = new URLSearchParams(location.search).get('simulateError') === '1';

// ---------- header: tabs + live fulfillment gauge ----------

const tabButtons = {
  1: document.getElementById('tabStep1'),
  2: document.getElementById('tabStep2'),
  3: document.getElementById('tabStep3'),
};
const gaugeFill = document.getElementById('gaugeFill');
const gaugePct = document.getElementById('gaugePct');

function updateGauge() {
  const fulfillment = computeFulfillment(state.fieldValues, state.tags);
  gaugeFill.style.width = `${fulfillment}%`;
  gaugePct.textContent = `${fulfillment}%`;
}

function updateTabAvailability() {
  tabButtons[2].disabled = !canProceedFromStep1(state.fieldValues);
  tabButtons[3].disabled = state.tags.length === 0;
}

function showStep(stepNumber) {
  if (stepNumber === 2 && tabButtons[2].disabled) return;
  if (stepNumber === 3 && tabButtons[3].disabled) return;

  document.querySelectorAll('.panel').forEach((el) => el.classList.remove('active'));
  document.getElementById(`step${stepNumber}`).classList.add('active');

  Object.entries(tabButtons).forEach(([num, btn]) => {
    btn.classList.toggle('active', Number(num) === stepNumber);
  });

  if (stepNumber === 2) renderStep2();
  if (stepNumber === 3) renderStep3();
}

Object.entries(tabButtons).forEach(([num, btn]) => {
  btn.addEventListener('click', () => showStep(Number(num)));
});

// ---------- step 1: 문제 분해 대시보드 ----------

const fieldsContainer = document.getElementById('fieldsContainer');
const toStep2Btn = document.getElementById('toStep2Btn');
const feedbackBtn = document.getElementById('feedbackBtn');
const feedbackStatus = document.getElementById('feedbackStatus');

function renderFields() {
  fieldsContainer.innerHTML = '';

  FIELD_DEFS.forEach(({ id, label, helper }) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.innerHTML = `
      <div class="cell-head">
        <span class="cell-title">${label}</span>
        <span class="cell-status" id="count-${id}">0/${MIN_LENGTH}자</span>
      </div>
      <p class="cell-helper">${helper}</p>
      <div class="field-wrap">
        <div class="field-backdrop" id="backdrop-${id}"></div>
        <textarea id="input-${id}" rows="4"></textarea>
      </div>
      <div class="field-message" id="message-${id}"></div>
      <p class="specificity-hint" id="specificity-${id}"></p>
      <button type="button" class="example-toggle" id="example-toggle-${id}">✏️ 예시 보기</button>
      <div class="scaffold-panel" id="example-panel-${id}"></div>
    `;
    fieldsContainer.appendChild(cell);

    const textarea = cell.querySelector(`#input-${id}`);
    textarea.addEventListener('input', () => onFieldInput(id, textarea.value));

    const example = getFieldExample(id);
    const exampleToggleBtn = cell.querySelector(`#example-toggle-${id}`);
    const examplePanel = cell.querySelector(`#example-panel-${id}`);
    if (example) {
      examplePanel.innerHTML = `
        <p><strong>모호한 예:</strong> ${example.vague}</p>
        <p><strong>구체적인 예:</strong> ${example.specific}</p>
      `;
      exampleToggleBtn.addEventListener('click', () => {
        examplePanel.classList.toggle('visible');
      });
    } else {
      exampleToggleBtn.style.display = 'none';
    }
  });
}

function onFieldInput(id, rawValue) {
  const value = rawValue.normalize('NFC');
  state.fieldValues[id] = value;

  const trimmedLength = value.trim().length;
  const countEl = document.getElementById(`count-${id}`);
  countEl.textContent = trimmedLength >= MIN_LENGTH ? '충족 ✓' : `${trimmedLength}/${MIN_LENGTH}자`;
  countEl.classList.toggle('ok', trimmedLength >= MIN_LENGTH);

  const result = validateField(value);
  document.getElementById(`message-${id}`).textContent = result.valid ? '' : result.message;

  const ambiguousMatches = detectAmbiguousExpressions(value);
  const specificityEl = document.getElementById(`specificity-${id}`);
  specificityEl.textContent =
    result.valid && ambiguousMatches.length === 0 && !hasSpecificityCue(value)
      ? `💡 ${SPECIFICITY_HINT_MESSAGE}`
      : '';

  renderBackdrop(id, value);
  toStep2Btn.disabled = !canProceedFromStep1(state.fieldValues);
  updateTabAvailability();
  updateGauge();
}

// 실시간으로 모호 표현에 빨간 밑줄을 그어 보여주는 backdrop (textarea와 같은 위치에 겹쳐진다)
function renderBackdrop(id, text) {
  const backdrop = document.getElementById(`backdrop-${id}`);
  backdrop.innerHTML = '';

  const matches = detectAmbiguousExpressions(text);
  let cursor = 0;
  matches.forEach(({ expression, message, index }) => {
    if (index > cursor) {
      backdrop.appendChild(document.createTextNode(text.slice(cursor, index)));
    }
    const mark = document.createElement('mark');
    mark.textContent = expression;
    mark.dataset.message = message;
    backdrop.appendChild(mark);
    cursor = index + expression.length;
  });
  if (cursor < text.length) {
    backdrop.appendChild(document.createTextNode(text.slice(cursor)));
  }
}

let ambiguousTip = null;
function closeAmbiguousTip() {
  if (ambiguousTip) {
    ambiguousTip.remove();
    ambiguousTip = null;
  }
}
document.addEventListener('click', (event) => {
  if (event.target.tagName === 'MARK' && event.target.closest('.field-backdrop')) {
    closeAmbiguousTip();
    const rect = event.target.getBoundingClientRect();
    ambiguousTip = document.createElement('div');
    ambiguousTip.className = 'ambiguous-tip';
    ambiguousTip.textContent = `💬 ${event.target.dataset.message}`;
    document.body.appendChild(ambiguousTip);
    ambiguousTip.style.top = `${rect.bottom + 8}px`;
    ambiguousTip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 248))}px`;
    event.stopPropagation();
  } else if (ambiguousTip && !event.target.closest('.ambiguous-tip')) {
    closeAmbiguousTip();
  }
});

async function handleFeedbackRequest() {
  feedbackStatus.className = 'feedback-status';
  feedbackStatus.textContent = '피드백을 불러오는 중...';

  try {
    const feedback = await requestFeedback(state.fieldValues, { simulateError: forceFeedbackError });
    const totalMatches = Object.values(feedback).reduce((sum, list) => sum + list.length, 0);
    feedbackStatus.textContent =
      totalMatches > 0
        ? `모호한 표현 ${totalMatches}개를 찾았습니다. 빨간 밑줄을 눌러 확인해보세요.`
        : '모호한 표현이 발견되지 않았습니다 ✓';
  } catch (error) {
    feedbackStatus.className = 'feedback-status error';
    feedbackStatus.innerHTML = '';
    const message = document.createElement('span');
    message.textContent = error.message;
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'retry-btn';
    retryBtn.textContent = '다시 시도';
    retryBtn.addEventListener('click', handleFeedbackRequest);
    feedbackStatus.appendChild(message);
    feedbackStatus.appendChild(retryBtn);
  }
}

feedbackBtn.addEventListener('click', handleFeedbackRequest);
toStep2Btn.addEventListener('click', () => showStep(2));

// ---------- step 2: 핵심 요소 태깅 ----------

const tagCardsContainer = document.getElementById('tagCardsContainer');
const selectedTextLabel = document.getElementById('selectedTextLabel');
const tagSummary = document.getElementById('tagSummary');
const toStep1Btn = document.getElementById('toStep1Btn');
const toStep3Btn = document.getElementById('toStep3Btn');
const hintBtn = document.getElementById('hintBtn');
const exampleBtn = document.getElementById('exampleBtn');
const hintPanel = document.getElementById('hintPanel');
const examplePanel = document.getElementById('examplePanel');

function renderFieldWithTags(text, tagsForField) {
  let segments = [{ text, tagged: false }];

  tagsForField.forEach((tag) => {
    const nextSegments = [];
    segments.forEach((segment) => {
      if (segment.tagged) {
        nextSegments.push(segment);
        return;
      }
      const idx = segment.text.indexOf(tag.text);
      if (idx === -1) {
        nextSegments.push(segment);
        return;
      }
      if (idx > 0) nextSegments.push({ text: segment.text.slice(0, idx), tagged: false });
      nextSegments.push({ text: tag.text, tagged: true, type: tag.type });
      const rest = segment.text.slice(idx + tag.text.length);
      if (rest) nextSegments.push({ text: rest, tagged: false });
    });
    segments = nextSegments;
  });

  return segments;
}

function renderStep2() {
  tagCardsContainer.innerHTML = '';

  FIELD_DEFS.forEach(({ id, label }) => {
    const text = state.fieldValues[id] || '';
    const tagsForField = state.tags.filter((t) => t.fieldId === id);

    const card = document.createElement('div');
    card.className = 'tag-card';
    card.innerHTML = `<h3>${label}</h3>`;

    const textEl = document.createElement('div');
    textEl.className = 'card-text';
    textEl.dataset.fieldId = id;

    renderFieldWithTags(text, tagsForField).forEach((segment) => {
      if (segment.tagged) {
        const mark = document.createElement('mark');
        mark.className = `tag-${segment.type}`;
        mark.textContent = segment.text;
        textEl.appendChild(mark);
      } else {
        textEl.appendChild(document.createTextNode(segment.text));
      }
    });

    card.appendChild(textEl);
    tagCardsContainer.appendChild(card);
  });

  renderTagSummary();
}

// ---- selection -> floating toolbar ----

let floatToolbar = null;
function closeFloatToolbar() {
  if (floatToolbar) {
    floatToolbar.remove();
    floatToolbar = null;
  }
}

function getSelectionInsideCards() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (!tagCardsContainer.contains(range.commonAncestorContainer)) return null;

  const text = range.toString().trim().normalize('NFC');
  if (!text) return null;

  const cardEl = (range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement
  ).closest('.card-text');
  if (!cardEl) return null;

  return { text, fieldId: cardEl.dataset.fieldId, range };
}

document.addEventListener('selectionchange', () => {
  if (!document.getElementById('step2').classList.contains('active')) return;

  const found = getSelectionInsideCards();
  if (!found) {
    closeFloatToolbar();
    return;
  }

  state.selection = { text: found.text, fieldId: found.fieldId };
  selectedTextLabel.textContent = `"${found.text}"`;
  showFloatToolbar(found.range);
});

function showFloatToolbar(range) {
  closeFloatToolbar();
  const rect = range.getBoundingClientRect();

  floatToolbar = document.createElement('div');
  floatToolbar.className = 'float-toolbar';
  TAG_TYPES.forEach((type) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tag-${type}`;
    btn.textContent = type;
    btn.addEventListener('mousedown', (event) => event.preventDefault()); // 선택 유지
    btn.addEventListener('click', () => assignTagToSelection(type));
    floatToolbar.appendChild(btn);
  });
  document.body.appendChild(floatToolbar);

  let top = rect.top - floatToolbar.offsetHeight - 8;
  if (top < 8) top = rect.bottom + 8;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - floatToolbar.offsetWidth - 8));
  floatToolbar.style.top = `${top}px`;
  floatToolbar.style.left = `${left}px`;
}

function assignTagToSelection(type) {
  if (!state.selection) return;

  const tag = createTag(state.selection.text, type, state.selection.fieldId);
  state.tags.push(tag);
  state.selection = null;
  selectedTextLabel.textContent = '(텍스트를 드래그해 선택하세요)';
  window.getSelection()?.removeAllRanges();
  closeFloatToolbar();

  updateTabAvailability();
  updateGauge();
  renderStep2();
}

function renderTagSummary() {
  tagSummary.innerHTML = '';

  TAG_TYPES.forEach((type) => {
    const group = document.createElement('div');
    group.className = 'tag-group';

    const items = state.tags.filter((t) => t.type === type);
    const heading = document.createElement('h4');
    heading.innerHTML = `<span class="dot tag-${type}"></span>${type} (${items.length})`;
    group.appendChild(heading);

    const list = document.createElement('ul');
    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.style.background = 'transparent';
      li.style.padding = '0';
      li.textContent = '아직 없음';
      list.appendChild(li);
    } else {
      items.forEach((tag) => {
        const li = document.createElement('li');
        const field = FIELD_DEFS.find((f) => f.id === tag.fieldId);

        const span = document.createElement('span');
        span.textContent = `[${field ? field.label : tag.fieldId}] ${tag.text}`;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.title = '태그 삭제';
        removeBtn.addEventListener('click', () => {
          state.tags = state.tags.filter((t) => t !== tag);
          updateTabAvailability();
          updateGauge();
          renderStep2();
        });

        li.appendChild(span);
        li.appendChild(removeBtn);
        list.appendChild(li);
      });
    }
    group.appendChild(list);
    tagSummary.appendChild(group);
  });
}

hintBtn.addEventListener('click', () => {
  const { hints } = getScaffoldingHints();
  hintPanel.innerHTML = `<ul>${hints.map((h) => `<li>${h}</li>`).join('')}</ul>`;
  hintPanel.classList.toggle('visible');
});

exampleBtn.addEventListener('click', () => {
  const { examples } = getScaffoldingHints();
  examplePanel.innerHTML = examples
    .map((ex) => `<p>예시: "${ex.text}" → <strong>${ex.type}</strong></p>`)
    .join('');
  examplePanel.classList.toggle('visible');
});

toStep1Btn.addEventListener('click', () => showStep(1));
toStep3Btn.addEventListener('click', () => showStep(3));

// ---------- step 3: 구조화된 결과 / 내보내기 ----------

const resultFields = document.getElementById('resultFields');
const resultTags = document.getElementById('resultTags');
const promptPreview = document.getElementById('promptPreview');
const copyPromptBtn = document.getElementById('copyPromptBtn');
const restartBtn = document.getElementById('restartBtn');
const copyStatus = document.getElementById('copyStatus');

function renderStep3() {
  const structured = structureProblem(state.fieldValues, state.tags);

  promptPreview.value = formatAsPrompt(structured);

  resultFields.innerHTML = '';
  structured.fields.forEach(({ label, value }) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    resultFields.appendChild(dt);
    resultFields.appendChild(dd);
  });

  resultTags.innerHTML = '';
  structured.tags.forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = `tag-chip tag-${tag.type}`;
    chip.textContent = `#${tag.text} (${tag.type})`;
    resultTags.appendChild(chip);
  });

  copyStatus.textContent = '';
}

async function copyPrompt() {
  const text = promptPreview.value;

  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    promptPreview.focus();
    promptPreview.select();
    document.execCommand('copy');
  }

  copyStatus.textContent = '복사되었습니다 ✓';
  setTimeout(() => {
    copyStatus.textContent = '';
  }, 2000);
}

copyPromptBtn.addEventListener('click', copyPrompt);
restartBtn.addEventListener('click', () => showStep(1));

// ---------- init ----------

renderFields();
updateTabAvailability();
updateGauge();
