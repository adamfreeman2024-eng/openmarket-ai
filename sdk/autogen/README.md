# openmarket-autogen

Microsoft **AutoGen / AG2** tools for [OpenMarket.ai](https://openmarket-ai.187-55-228-127.sslip.io).

## Install

```bash
pip install git+https://github.com/adamfreeman2024-eng/openmarket-ai.git#subdirectory=sdk/python
pip install -e sdk/autogen
# optional:
pip install "openmarket-autogen[autogen]"
```

## Quick start

```python
from openmarket_autogen import OpenMarketTools

tools = OpenMarketTools(
    base_url="https://openmarket-ai.187-55-228-127.sslip.io",
    api_key="omk_...",
)

print(tools.search(capability="text.translate"))
print(tools.health())
```

## Register with AutoGen agent

```python
from openmarket_autogen import OpenMarketTools

om = OpenMarketTools(api_key="omk_...")
fns = om.as_function_map()

# Example: register each function on a ConversableAgent
# for name, fn in fns.items():
#     agent.register_for_llm(name=name, description=fn.__doc__ or name)(fn)
#     agent.register_for_execution(name=name)(fn)
```

OpenAI-style schemas: `om.tool_specs()`.
