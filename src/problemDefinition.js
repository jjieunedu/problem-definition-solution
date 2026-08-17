export const MIN_LENGTH = 20;

export const FIELD_DEFS = [
  { id: 'currentState', label: '현재 상태', helper: '지금 무엇이 문제인지, 왜 불편/부족한지' },
  { id: 'goalState', label: '목표 상태', helper: '해결 후 어떤 상태가 되길 원하는지' },
  { id: 'constraints', label: '필요한 조건(제약사항)', helper: '시간, 자원, 규칙 등 지켜야 할 조건' },
  { id: 'stakeholders', label: '이해관계자', helper: '이 문제와 관련된 사람/그룹' },
  { id: 'successCriteria', label: '성공 기준', helper: '무엇을 보면 "해결됐다"고 판단할 수 있는지' },
];

export const TAG_TYPES = ['현재상태', '목표', '제약', '이해관계자', '성공기준'];

export const MEANINGLESS_INPUT_MESSAGE = '문제의 구체적인 내용을 작성해주세요.';
export const FEEDBACK_ERROR_MESSAGE = '피드백을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
export const PERSONAL_INFO_NOTICE =
  '이름, 연락처, 친구·교사 등 개인을 식별할 수 있는 정보는 입력하지 마세요. AI에 입력하기 전에 개인정보가 포함되어 있지 않은지 확인하세요.';

const AMBIGUOUS_EXPRESSIONS = [
  { expression: '그냥', message: '무엇을 어떻게 했는지/할 것인지 구체적으로 작성해보세요.' },
  { expression: '잘', message: '어떤 기준으로 "잘"인지 구체적으로 작성해보세요.' },
  { expression: '좋게', message: '어떤 상태가 되어야 "좋은" 것인지 구체적으로 작성해보세요.' },
  { expression: '많이', message: '구체적인 수치나 정도로 작성해보세요.' },
  { expression: '적당히', message: '구체적인 기준을 작성해보세요.' },
];

export function detectAmbiguousExpressions(text) {
  // 한글은 완성형(NFC)과 자모 분해형(NFD)이 서로 다른 문자열로 취급되므로,
  // 입력기/OS에 따라 다르게 들어와도 사전과 매칭되도록 정규화한다.
  const source = (text || '').normalize('NFC');
  const found = [];

  for (const { expression, message } of AMBIGUOUS_EXPRESSIONS) {
    let index = source.indexOf(expression);
    while (index !== -1) {
      found.push({ expression, message, index });
      index = source.indexOf(expression, index + expression.length);
    }
  }

  return found.sort((a, b) => a.index - b.index);
}

export function isMeaninglessRepetition(text) {
  const trimmed = (text || '').normalize('NFC').trim();
  if (!trimmed) return true;

  const withoutSpaces = trimmed.replace(/\s/g, '');
  if (/^(.)\1+$/.test(withoutSpaces)) return true;

  const words = trimmed.split(/\s+/);
  if (words.length >= 3 && new Set(words).size === 1) return true;

  if (withoutSpaces.length >= MIN_LENGTH && new Set(withoutSpaces).size <= 2) return true;

  return false;
}

export function validateField(text) {
  const trimmed = (text || '').normalize('NFC').trim();

  if (trimmed.length < MIN_LENGTH) {
    return { valid: false, reason: 'too_short', message: `${MIN_LENGTH}자 이상 작성해주세요.` };
  }

  if (isMeaninglessRepetition(trimmed)) {
    return { valid: false, reason: 'meaningless', message: MEANINGLESS_INPUT_MESSAGE };
  }

  return { valid: true };
}

export function canProceedFromStep1(fieldValues) {
  return FIELD_DEFS.every(({ id }) => {
    const value = fieldValues[id] || '';
    return validateField(value).valid && detectAmbiguousExpressions(value).length === 0;
  });
}

export function createTag(text, type, fieldId) {
  const trimmedText = (text || '').trim();

  if (!trimmedText) {
    throw new Error('태그로 지정할 텍스트를 선택해주세요.');
  }
  if (!TAG_TYPES.includes(type)) {
    throw new Error(`알 수 없는 태그 유형입니다: ${type}`);
  }

  return { text: trimmedText, type, fieldId };
}

export function getScaffoldingHints() {
  return {
    hints: [
      '"누가"에 해당하는 단어를 찾아보세요. → 이해관계자',
      '숫자, 기간, 규칙처럼 지켜야 할 조건을 나타내는 표현을 찾아보세요. → 제약사항',
      '"~하고 싶다", "~해야 한다"처럼 바라는 상태를 나타내는 문장을 찾아보세요. → 목표 상태',
      '무엇을 보면 해결됐다고 판단할 수 있는지 나타내는 표현을 찾아보세요. → 성공 기준',
    ],
    examples: [{ text: '잔반이 많이 남는다', type: '현재상태' }],
  };
}

export async function requestFeedback(fieldValues, options = {}) {
  const { simulateError = false } = options;

  if (simulateError) {
    throw new Error(FEEDBACK_ERROR_MESSAGE);
  }

  const feedback = {};
  for (const { id } of FIELD_DEFS) {
    feedback[id] = detectAmbiguousExpressions(fieldValues[id] || '');
  }
  return feedback;
}

export function structureProblem(fieldValues, tags) {
  return {
    fields: FIELD_DEFS.map(({ id, label }) => ({ id, label, value: fieldValues[id] || '' })),
    tags: tags.map((tag) => ({ ...tag })),
  };
}

export function computeFulfillment(fieldValues, tags) {
  const fieldWeight = 0.6;
  const tagWeight = 0.4;

  const validFieldCount = FIELD_DEFS.filter(({ id }) => {
    const value = fieldValues[id] || '';
    return validateField(value).valid && detectAmbiguousExpressions(value).length === 0;
  }).length;
  const fieldScore = validFieldCount / FIELD_DEFS.length;

  const coveredTagTypes = new Set(tags.map((tag) => tag.type));
  const tagScore = coveredTagTypes.size / TAG_TYPES.length;

  return Math.round((fieldScore * fieldWeight + tagScore * tagWeight) * 100);
}

export function formatAsPrompt(structured) {
  const lines = [
    '다음은 학생이 구조화한 문제 정의입니다. 이 내용을 바탕으로 문제 해결 아이디어를 제안해주세요.',
    '',
  ];

  structured.fields.forEach(({ label, value }) => {
    lines.push(`- ${label}: ${value}`);
  });

  if (structured.tags.length > 0) {
    lines.push('');
    lines.push(
      '핵심 태그: ' + structured.tags.map((tag) => `#${tag.text}(${tag.type})`).join(' ')
    );
  }

  return lines.join('\n');
}
