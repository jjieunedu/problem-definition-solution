import { describe, it, expect } from 'vitest';
import {
  MIN_LENGTH,
  FEEDBACK_ERROR_MESSAGE,
  PERSONAL_INFO_NOTICE,
  detectAmbiguousExpressions,
  validateField,
  canProceedFromStep1,
  createTag,
  getScaffoldingHints,
  requestFeedback,
  structureProblem,
  formatAsPrompt,
  computeFulfillment,
} from '../src/problemDefinition.js';

const VALID_FIELD_VALUES = {
  currentState: '학교 급식에서 잔반이 매일 상당량 남아 음식물 쓰레기가 늘어나고 있다',
  goalState: '한 달 안에 급식 잔반량을 30퍼센트 줄이고 잔반 무게를 측정해 확인한다',
  constraints: '추가 예산 없이 기존 급식 운영 방식 안에서 개선해야 한다',
};

describe('정상 케이스', () => {
  it('정상 1. 모호 표현이 포함된 문장에서 하이라이트할 표현과 구체적인 피드백을 제공한다', () => {
    const feedback = detectAmbiguousExpressions(
      '그냥 급식을 잘 관리해서 좋게 만들고 잔반을 많이 줄이고 싶다'
    );
    const expressions = feedback.map((f) => f.expression);

    expect(expressions).toEqual(expect.arrayContaining(['그냥', '잘', '좋게', '많이']));
    feedback.forEach((f) => {
      expect(typeof f.message).toBe('string');
      expect(f.message.length).toBeGreaterThan(0);
      expect(typeof f.index).toBe('number');
    });
  });

  it('정상 1-1. 자모 분해형(NFD)으로 입력된 모호 표현도 정상적으로 찾아낸다', () => {
    const nfdText = ('급식 잔반을 ' + '많이'.normalize('NFD') + ' 줄이고 싶다').normalize('NFD');
    const feedback = detectAmbiguousExpressions(nfdText);

    expect(feedback.some((f) => f.expression === '많이')).toBe(true);
  });

  it('정상 2. 3개 항목과 태깅된 핵심 요소로 구조화된 결과를 만들고 AI 프롬프트 텍스트로 변환할 수 있다', () => {
    Object.values(VALID_FIELD_VALUES).forEach((value) => {
      expect(validateField(value).valid).toBe(true);
    });
    expect(canProceedFromStep1(VALID_FIELD_VALUES)).toBe(true);

    const tag = createTag('잔반이 매일 상당량 남아', '현재상태', 'currentState');
    const structured = structureProblem(VALID_FIELD_VALUES, [tag]);

    expect(structured.fields).toHaveLength(3);
    expect(structured.tags).toEqual([tag]);

    const prompt = formatAsPrompt(structured);
    expect(typeof prompt).toBe('string');
    Object.values(VALID_FIELD_VALUES).forEach((value) => {
      expect(prompt).toContain(value);
    });
    expect(prompt).toContain(tag.text);
  });
});

describe('실패/예외 케이스', () => {
  it('실패 1. 20자 미만이거나 의미 없는 반복 입력이면 통과시키지 않는다', () => {
    const tooShort = validateField('짧은 문장');
    expect(tooShort.valid).toBe(false);
    expect(tooShort.message).toMatch(new RegExp(`${MIN_LENGTH}자`));

    const repeated = validateField('가가가가가가가가가가가가가가가가가가가가');
    expect(repeated.valid).toBe(false);
    expect(repeated.message).toBe('문제의 구체적인 내용을 작성해주세요.');

    const invalidFieldValues = { ...VALID_FIELD_VALUES, currentState: '짧은 문장' };
    expect(canProceedFromStep1(invalidFieldValues)).toBe(false);
  });

  it('실패 2. 태깅을 어려워하는 경우 힌트와 예시를 제공하고, 선택한 텍스트와 태그의 연결이 명확히 드러난다', () => {
    const scaffolding = getScaffoldingHints();
    expect(scaffolding.hints.length).toBeGreaterThan(0);
    expect(scaffolding.examples.length).toBeGreaterThan(0);
    scaffolding.examples.forEach((example) => {
      expect(example).toHaveProperty('text');
      expect(example).toHaveProperty('type');
    });

    const tag = createTag('잔반이 많이 남는다', '현재상태', 'currentState');
    expect(tag).toEqual({ text: '잔반이 많이 남는다', type: '현재상태', fieldId: 'currentState' });

    expect(() => createTag('잔반이 많이 남는다', '알수없음', 'currentState')).toThrow();
  });

  it('실패 3. AI 피드백 호출이 실패하면 오류를 알리고 작성 내용은 보존된다', async () => {
    const fieldValues = { currentState: VALID_FIELD_VALUES.currentState };

    await expect(requestFeedback(fieldValues, { simulateError: true })).rejects.toThrow(
      FEEDBACK_ERROR_MESSAGE
    );
    expect(fieldValues.currentState).toBe(VALID_FIELD_VALUES.currentState);
  });

  it('실패 4. 개인정보 입력 가능성에 대비해 확인 안내 문구를 제공한다', () => {
    expect(PERSONAL_INFO_NOTICE).toMatch(/개인정보/);
    expect(PERSONAL_INFO_NOTICE.length).toBeGreaterThan(0);
  });
});

describe('부가 기능: 문제 정의 충족도', () => {
  it('아무것도 작성하지 않으면 충족도는 0%이다', () => {
    const emptyValues = Object.fromEntries(Object.keys(VALID_FIELD_VALUES).map((k) => [k, '']));
    expect(computeFulfillment(emptyValues, [])).toBe(0);
  });

  it('3개 항목을 모두 유효하게 작성하면 필드 점수만큼 충족도가 오르고, 5개 태그 유형을 모두 채우면 100%가 된다', () => {
    const partial = computeFulfillment(VALID_FIELD_VALUES, []);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(100);

    const allTags = ['현재상태', '목표', '제약', '이해관계자', '성공기준'].map((type) =>
      createTag('예시 텍스트', type, 'currentState')
    );
    expect(computeFulfillment(VALID_FIELD_VALUES, allTags)).toBe(100);
  });
});
