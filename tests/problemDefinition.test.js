import { describe, it, expect } from 'vitest';
import {
  MIN_PROBLEM_LENGTH,
  validateProblemStatement,
  detectAmbiguousExpressions,
  structureProblem,
  getScaffoldingHints,
  formatAsPrompt,
} from '../src/problemDefinition.js';

// 정상 케이스 (2)

describe('정상 케이스', () => {
  it('학생이 해결하고 싶은 문제를 작성하면, 모호한 표현에 대한 피드백을 제공받아야 한다', () => {
    const feedback = detectAmbiguousExpressions(
      '학생들이 좀 더 재미있게 공부할 수 있는 방법을 적당히 찾고 싶다'
    );

    expect(Array.isArray(feedback)).toBe(true);
    expect(feedback.length).toBeGreaterThan(0);
    expect(feedback.some((f) => f.expression.includes('좀 더'))).toBe(true);
    expect(feedback.some((f) => f.expression.includes('적당히'))).toBe(true);
    feedback.forEach((f) => {
      expect(typeof f.message).toBe('string');
      expect(f.message.length).toBeGreaterThan(0);
    });
  });

  it('학생은 최종적으로 자신이 제시한 문제에 대해 핵심 요소와 함께 구조화된 문제 정의 결과를 제공받아야 한다', () => {
    const problem = '중학교 3학년 학생들의 수학 시험 불안감을 낮추고 싶다';
    const coreElements = [
      { type: '대상', value: '중학교 3학년 학생' },
      { type: '목표', value: '수학 시험 불안감 감소' },
      { type: '제약', value: '학교 정규 수업 시간 내' },
    ];

    const result = structureProblem(problem, coreElements);

    expect(result).toHaveProperty('problem', problem);
    expect(result).toHaveProperty('coreElements');
    expect(result.coreElements).toHaveLength(3);
    expect(result.coreElements).toEqual(expect.arrayContaining(coreElements));
    expect(result).toHaveProperty('summary');
    expect(typeof result.summary).toBe('string');
  });
});

// 실패/예외 케이스 (3)

describe('실패/예외 케이스', () => {
  it('학생이 20자 미만으로 문제를 작성하면, 20자 이상 작성이 필요하다고 알려줘야 한다', () => {
    const tooShort = validateProblemStatement('짧은 문장');

    expect(tooShort.valid).toBe(false);
    expect(tooShort.message).toMatch(/20자/);

    const longEnough = validateProblemStatement(
      '중학교 3학년 학생들의 수학 시험 불안감을 낮추고 싶다'
    );
    expect(longEnough.valid).toBe(true);
    expect('중학교 3학년 학생들의 수학 시험 불안감을 낮추고 싶다'.length).toBeGreaterThanOrEqual(
      MIN_PROBLEM_LENGTH
    );
  });

  it('학생이 핵심 요소 추출(태깅)을 어려워할 때, 스캐폴딩(힌트, 예시 미리보기)을 제공받을 수 있어야 한다', () => {
    const scaffolding = getScaffoldingHints();

    expect(scaffolding).toHaveProperty('hints');
    expect(scaffolding).toHaveProperty('examples');
    expect(scaffolding.hints.length).toBeGreaterThan(0);
    expect(scaffolding.examples.length).toBeGreaterThan(0);
    scaffolding.examples.forEach((example) => {
      expect(example).toHaveProperty('type');
      expect(example).toHaveProperty('value');
    });
  });

  it('최종 결과물을 학생이 AI에 입력할 프롬프트 형태로 복사·활용할 수 있어야 한다', () => {
    const structured = {
      problem: '중학교 3학년 학생들의 수학 시험 불안감을 낮추고 싶다',
      coreElements: [
        { type: '대상', value: '중학교 3학년 학생' },
        { type: '목표', value: '수학 시험 불안감 감소' },
      ],
      summary: '중학교 3학년 학생의 수학 시험 불안감 감소를 위한 문제 정의',
    };

    const prompt = formatAsPrompt(structured);

    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain(structured.problem);
    structured.coreElements.forEach((element) => {
      expect(prompt).toContain(element.value);
    });
  });
});
