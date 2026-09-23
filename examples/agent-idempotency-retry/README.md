# Agent retry idempotency demo

Run the deterministic proof:

```sh
python3 demo.py
```

Expected result: the unsafe retry creates two side effects; the retry carrying
the same action key returns the first result and leaves exactly one side effect.

The example is original MIT-licensed code. It uses no external service, token,
customer data, stock media, or paid API.
