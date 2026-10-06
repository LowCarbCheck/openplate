# V4 misc scoring (2026-10-06)

Written by `/tmp/v4_misc.py` over `harness.score_misc`. No model call. Wait is total wait (all attempts) in seconds.

## C3v4
- note: v4-eu-cell-38-minimal-newprompt-r1: 50 records, ids differ
- holdout: n 108 invalid 0 http {'200': 108} not_stop {} cost_mean 0.00527 (cost_calls 108, total 0.5688) wait p50 5.8 p95 25.0 max 84.8 reasoning_tokens_mean 0 (recorded 108) prov {'Google': 108} retried 1 costnull 0
- main: n 91 invalid 0 http {'200': 91} not_stop {} cost_mean 0.00447 (cost_calls 91, total 0.4068) wait p50 4.6 p95 7.9 max 64.5 reasoning_tokens_mean 7 (recorded 91) prov {'Google': 91} retried 0 costnull 0
- plates: n 50 invalid 0 http {'200': 50} not_stop {} cost_mean 0.00942 (cost_calls 50, total 0.4711) wait p50 9.5 p95 39.4 max 131.3 reasoning_tokens_mean 98 (recorded 50) prov {'Google': 50} retried 0 costnull 0
- brands: 5 items, found 5, rated high 0 [], brand field right 5/5
- vague foods rated low: 1/3; not low: [('m1:t034', 'medium'), ('m1:t035', 'medium')]

## F25v4
- note: v4-eu-cell-25-flash-newprompt-r1: 50 records, ids differ
- note: v4-eu-cell-25-flash-newprompt-r2: 50 records, ids differ
- note: v4-eu-cell-25-flash-newprompt-r3: 50 records, ids differ
- holdout: n 108 invalid 0 http {'200': 108} not_stop {} cost_mean 0.00417 (cost_calls 108, total 0.4504) wait p50 8.6 p95 25.9 max 33.5 reasoning_tokens_mean 748 (recorded 108) prov {'Google': 108} retried 17 costnull 0
- plates: n 150 invalid 1 http {'200': 150} not_stop {'length': 1} cost_mean 0.00587 (cost_calls 150, total 0.8807) wait p50 11.2 p95 21.3 max 38.7 reasoning_tokens_mean 742 (recorded 150) prov {'Google': 150} retried 4 costnull 0
  - failures: {'p3:45': (200, 'length', '', 1)}
  - invalid ids: ['p3:45']

## G31
- note: v4-eu-cell-31-lite-newprompt-r1: 50 records, ids differ
- note: v4-eu-cell-31-lite-newprompt-r2: 50 records, ids differ
- note: v4-eu-cell-31-lite-newprompt-r3: 50 records, ids differ
- holdout: n 108 invalid 0 http {'200': 108} not_stop {} cost_mean 0.00219 (cost_calls 108, total 0.2364) wait p50 2.5 p95 3.4 max 3.9 reasoning_tokens_mean 0 (recorded 108) prov {'Google': 108} retried 0 costnull 0
- main: n 91 invalid 0 http {'200': 91} not_stop {} cost_mean 0.00180 (cost_calls 91, total 0.1638) wait p50 1.9 p95 2.8 max 3.0 reasoning_tokens_mean 0 (recorded 91) prov {'Google': 91} retried 0 costnull 0
- plates: n 150 invalid 0 http {'200': 150} not_stop {} cost_mean 0.00331 (cost_calls 150, total 0.4964) wait p50 3.9 p95 6.7 max 8.1 reasoning_tokens_mean 0 (recorded 150) prov {'Google': 150} retried 0 costnull 0
- brands: 5 items, found 4, rated high 3 ['m1:t017', 'm1:t057', 'm1:t076'], brand field right 4/4
- vague foods rated low: 0/3; not low: [('m1:t034', 'medium'), ('m1:t035', 'medium'), ('m1:t071', 'medium')]

## O6
- note: v4-eu-cell-gpt6-luna-newprompt-r1: 50 records, ids differ
- note: v4-eu-cell-gpt6-luna-newprompt-r2: 50 records, ids differ
- note: v4-eu-cell-gpt6-luna-newprompt-r3: 50 records, ids differ
- holdout: n 108 invalid 3 http {'200': 108} not_stop {'content_filter': 3} cost_mean 0.00055 (cost_calls 108, total 0.0598) wait p50 8.7 p95 16.1 max 22.4 reasoning_tokens_mean 539 (recorded 108) prov {'Azure': 108} retried 0 costnull 0
  - failures: {'h1:h005': (200, 'content_filter', '', 1), 'h2:h005': (200, 'content_filter', '', 1), 'h3:h005': (200, 'content_filter', '', 1)}
  - invalid ids: ['h1:h005', 'h2:h005', 'h3:h005']
- main: n 91 invalid 0 http {'200': 91} not_stop {} cost_mean 0.00039 (cost_calls 91, total 0.0358) wait p50 6.8 p95 13.5 max 18.4 reasoning_tokens_mean 345 (recorded 91) prov {'Azure': 91} retried 0 costnull 0
- plates: n 150 invalid 1 http {'200': 150} not_stop {'None': 1} cost_mean 0.00094 (cost_calls 149, total 0.1400) wait p50 13.1 p95 22.1 max 34.3 reasoning_tokens_mean 753 (recorded 149) prov {'Azure': 149, None: 1} retried 0 costnull 1
  - failures: {'p3:06': (200, None, 'API error in a 200 body: {"message": "upstream connect error or discon', 1)}
  - invalid ids: ['p3:06']
- brands: 5 items, found 5, rated high 0 [], brand field right 5/5
- vague foods rated low: 0/3; not low: [('m1:t034', 'medium'), ('m1:t035', 'medium'), ('m1:t071', 'medium')]
