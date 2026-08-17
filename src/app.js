import {
  FIELD_DEFS,
  TAG_TYPES,
  MIN_LENGTH,
  validateField,
  detectAmbiguousExpressions,
  canProceedFromStep1,
  createTag,
  getScaffoldingHints,
  requestFeedback,
  structureProblem,
  formatAsPrompt,
  computeFulfillment,
} from './problemDefinition.js';

const state = {
  fieldValues: Object.fromEntries(FIELD_DEFS.map(({ id }) => [id, ''])),
  tags: [],
  selection: null, // { text, fieldId }
};

const forceFeedbackError = new URLSearchParams(location.search).get('simulateError') === '1';

// ---------- navigation ----------

function showStep(stepNumber) {
  document.querySelectorAll('.step').forEach((el) => el.classList.remove('active'));
  document.getElementById(`step${stepNumber}`).classList.add('active');

  if (stepNumber === 2) renderStep2();
  if (stepNumber === 3) renderStep3();
}

// ---------- step 1: 문제 분해 대시보드 ----------

const fieldsContainer = document.getElementById('fieldsContainer');
const toStep2Btn = document.getElementById('toStep2Btn');
const feedbackBtn = document.getElementById('feedbackBtn');
const feedbackStatus = document.getElementById('feedbackStatus');

function renderFields() {
  fieldsContainer.innerHTML = '';

  FIELD_DEFS.forEach(({ id, label, helper }) => {
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `
      <div class="field-label">
        <span>${label}</span>
        <span class="char-count" id="count-${id}">0/${MIN_LENGTH}자</span>
      </div>
      <p class="field-helper">${helper}</p>
      <div class="field-wrap">
        <div class="field-backdrop" id="backdrop-${id}"></div>
        <textarea id="input-${id}" rows="3"></textarea>
      </div>
      <div class="field-message" id="message-${id}"></div>
    `;
    fieldsContainer.appendChild(field);

    const textarea = field.querySelector(`#input-${id}`);
    textarea.addEventListener('input', () => onFieldInput(id, textarea.value));
  });
}

function onFieldInput(id, value) {
  state.fieldValues[id] = value;

  const trimmedLength = value.trim().length;
  const countEl = document.getElementById(`count-${id}`);
  countEl.textContent = `${trimmedLength}/${MIN_LENGTH}자`;
  countEl.classList.toggle('ok', trimmedLength >= MIN_LENGTH);
  countEl.classList.toggle('warn', trimmedLength < MIN_LENGTH);

  const result = validateField(value);
  document.getElementById(`message-${id}`).textContent = result.valid ? '' : result.message;

  renderBackdrop(id, value);
  updateStep1NextButton();
}

function updateStep1NextButton() {
  toStep2Btn.disabled = !canProceedFromStep1(state.fieldValues);
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
toStep2Btn.addEventListener('click', () => {
  if (!canProceedFromStep1(state.fieldValues)) return;
  showStep(2);
});

// ---------- step 2: 핵심 요소 태깅 ----------

const tagCardsContainer = document.getElementById('tagCardsContainer');
const selectedTextLabel = document.getElementById('selectedTextLabel');
const tagButtonsContainer = document.getElementById('tagButtons');
const tagListItems = document.getElementById('tagListItems');
const toStep1Btn = document.getElementById('toStep1Btn');
const toStep3Btn = document.getElementById('toStep3Btn');
const hintBtn = document.getElementById('hintBtn');
const exampleBtn = document.getElementById('exampleBtn');
const hintPanel = document.getElementById('hintPanel');
const examplePanel = document.getElementById('examplePanel');

TAG_TYPES.forEach((type) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = type;
  btn.addEventListener('click', () => assignTagToSelection(type));
  tagButtonsContainer.appendChild(btn);
});

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

    textEl.addEventListener('mouseup', () => onCardTextSelect(id));
    card.appendChild(textEl);
    tagCardsContainer.appendChild(card);
  });

  renderTagList();
  updateStep2NextButton();
}

function onCardTextSelect(fieldId) {
  const selection = window.getSelection();
  const text = selection ? selection.toString().trim() : '';

  if (!text) return;

  state.selection = { text, fieldId };
  selectedTextLabel.textContent = `"${text}"`;
}

function assignTagToSelection(type) {
  if (!state.selection) {
    selectedTextLabel.textContent = '(먼저 카드 안의 텍스트를 드래그해 선택하세요)';
    return;
  }

  const tag = createTag(state.selection.text, type, state.selection.fieldId);
  state.tags.push(tag);
  state.selection = null;
  selectedTextLabel.textContent = '(텍스트를 드래그해 선택하세요)';
  window.getSelection()?.removeAllRanges();

  renderStep2();
}

function renderTagList() {
  tagListItems.innerHTML = '';

  if (state.tags.length === 0) {
    const li = document.createElement('li');
    li.textContent = '아직 태깅된 요소가 없습니다.';
    tagListItems.appendChild(li);
    return;
  }

  state.tags.forEach((tag, index) => {
    const field = FIELD_DEFS.find((f) => f.id === tag.fieldId);
    const li = document.createElement('li');

    const label = document.createElement('span');
    label.textContent = `[${field ? field.label : tag.fieldId}] "${tag.text}" → ${tag.type}`;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '삭제';
    removeBtn.style.marginLeft = '8px';
    removeBtn.addEventListener('click', () => {
      state.tags.splice(index, 1);
      renderStep2();
    });

    li.appendChild(label);
    li.appendChild(removeBtn);
    tagListItems.appendChild(li);
  });
}

function updateStep2NextButton() {
  toStep3Btn.disabled = state.tags.length === 0;
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
toStep3Btn.addEventListener('click', () => {
  if (state.tags.length === 0) return;
  showStep(3);
});

// ---------- step 3: 구조화된 결과 ----------

const resultFields = document.getElementById('resultFields');
const resultTags = document.getElementById('resultTags');
const copyPromptBtn = document.getElementById('copyPromptBtn');
const restartBtn = document.getElementById('restartBtn');
const copyStatus = document.getElementById('copyStatus');
const gaugeFill = document.getElementById('gaugeFill');
const gaugePct = document.getElementById('gaugePct');

function renderStep3() {
  const structured = structureProblem(state.fieldValues, state.tags);

  const fulfillment = computeFulfillment(state.fieldValues, state.tags);
  gaugeFill.style.width = `${fulfillment}%`;
  gaugePct.textContent = `${fulfillment}%`;

  resultFields.innerHTML = '';
  structured.fields.forEach(({ label, value }) => {
    const dt = document.createElement('dt');
    dt.textContent = `▸ ${label}`;
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
  copyPromptBtn.onclick = () => copyPrompt(structured);
}

async function copyPrompt(structured) {
  const prompt = formatAsPrompt(structured);

  try {
    await navigator.clipboard.writeText(prompt);
  } catch (error) {
    const textarea = document.createElement('textarea');
    textarea.value = prompt;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  copyStatus.textContent = '클립보드에 복사되었습니다.';
}

restartBtn.addEventListener('click', () => showStep(1));

// ---------- init ----------

renderFields();
updateStep1NextButton();
