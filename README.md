# exp

A basic expression parser for Deno.

## Example

```sh
$ deno run --allow-read=./ scripts/parser.ts --file scripts/test.exp
```

```json
{
  "success": true,
  "value": {
    "range": {
      "start": 0,
      "end": 19
    },
    "text": "A + foo.bar.baz(42)",
    "value": {
      "left": {
        "range": {
          "start": 0,
          "end": 2
        },
        "text": "A ",
        "value": [
          {
            "range": {
              "start": 0,
              "end": 2
            },
            "text": "A ",
            "value": "A",
            "kind": 8,
            "scope": {
              "locals": {}
            }
          }
        ],
        "kind": 9,
        "scope": {
          "locals": {}
        }
      },
      "op": {
        "range": {
          "start": 2,
          "end": 4
        },
        "text": "+ ",
        "value": "+",
        "kind": 21,
        "scope": {
          "locals": {}
        }
      },
      "right": {
        "range": {
          "start": 4,
          "end": 19
        },
        "text": "foo.bar.baz(42)",
        "value": {
          "identifier": {
            "range": {
              "start": 4,
              "end": 15
            },
            "text": "foo.bar.baz",
            "value": [
              {
                "range": {
                  "start": 4,
                  "end": 7
                },
                "text": "foo",
                "value": "foo",
                "kind": 8,
                "scope": {
                  "locals": {}
                }
              },
              {
                "range": {
                  "start": 8,
                  "end": 11
                },
                "text": "bar",
                "value": "bar",
                "kind": 8,
                "scope": {
                  "locals": {}
                }
              },
              {
                "range": {
                  "start": 12,
                  "end": 15
                },
                "text": "baz",
                "value": "baz",
                "kind": 8,
                "scope": {
                  "locals": {}
                }
              }
            ],
            "kind": 9,
            "scope": {
              "locals": {}
            }
          },
          "arguments": [
            {
              "range": {
                "start": 16,
                "end": 18
              },
              "text": "42",
              "value": 42,
              "kind": 3,
              "scope": {
                "locals": {}
              }
            }
          ]
        },
        "kind": 10,
        "scope": {
          "locals": {}
        }
      }
    },
    "kind": 0,
    "scope": {
      "locals": {}
    }
  },
  "ctx": {
    "text": "A + foo.bar.baz(42)",
    "index": 19
  }
}
```


## License

MIT © [Claudiu Ceia](https://github.com/ClaudiuCeia)
