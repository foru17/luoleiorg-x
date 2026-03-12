# AI Chat Eval

`data/eval/gold-set.json` is the baseline evaluation set for the blog chat system.

## Goal

Use a stable set of questions to compare:

- current pipeline vs changed pipeline
- evidence-analysis on vs off
- lexical retrieval vs hybrid retrieval
- prompt changes before vs after

Without this file, any quality claim is anecdotal.

## Case Schema

Each case uses this shape:

```json
{
  "id": "profile-self-intro-001",
  "category": "profile",
  "question": "介绍一下你自己",
  "answerMode": "fact",
  "mustHitSourceIds": ["exp:独立-2024年4月---至今"],
  "supportingFactIds": ["travel:日本"],
  "expectedTopics": ["独立开发", "博客"],
  "forbiddenClaims": ["未公开收入"],
  "notes": "可选说明"
}
```

## Field Meaning

- `id`: stable case id
- `category`: `profile | career | project | travel | race | reading | opinion | recommendation | no_answer`
- `question`: user question
- `answerMode`: expected response type
  - `fact`
  - `list`
  - `count`
  - `timeline`
  - `opinion`
  - `recommendation`
  - `unknown`
- `mustHitSourceIds`: public source docs that should support the answer
- `supportingFactIds`: optional derived fact ids useful for aggregation checks
- `expectedTopics`: coarse topics or entities that should appear
- `forbiddenClaims`: claims that must not appear
- `notes`: optional case-specific rule

## Initial Coverage

The initial gold set targets 30 questions:

- self/profile/career
- projects and technical work
- travel / marathon / reading aggregation
- opinion and recommendation
- no-answer / private data refusal

## Next Step

Add a runner script that:

1. sends each `question` through `/api/chat`
2. stores the final answer
3. records latency
4. checks:
   - answer mode match
   - source coverage
   - forbidden claim violations
   - unsupported count claims

## Command

```bash
pnpm eval:chat --base-url http://localhost:3000
pnpm eval:chat --case travel-countries-001
pnpm eval:chat --dry-run
pnpm eval:chat --rescore data/eval/results.json
```

## Latest Baseline

2026-03-09 local validation on `http://localhost:3003` reached:

- `30/30` passed
- `passRate = 1.0`
- `avgSourceCoverage = 0.882`
- `avgTopicCoverage = 0.914`
- `answerModeMatchRate = 0.867`
- `forbiddenViolationCount = 0`

This run includes a deterministic post-generation `citation guard` in the `/api/chat` response pipeline:

- `unknown` answers are collapsed to a short refusal
- direct-hit factual answers without known citations get one grounded source link
- travel yes/no fact answers can fall back to a concise grounded answer from the strongest direct source
