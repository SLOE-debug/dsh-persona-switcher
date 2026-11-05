"""Present controller state without claiming that an unobserved request succeeded."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class StatusText:
    summary: str
    discovery: str
    requests: str
    skipped: str


def render_status(result: dict[str, Any]) -> StatusText:
    """Keep entry discovery, a prepared persona, and observed hits distinct."""
    phase = result.get("phase")
    persona = result.get("persona")
    subject = f"人格“{persona}”" if persona else "人格"
    summaries = {
        "connected": "DSH 已连接，尚未识别请求入口。",
        "discovering": "正在识别请求入口…",
        "ready": "请求入口已识别，可以切换人格。",
        "armed": f"{subject}已就绪，等待下一次请求。",
        "observed": f"已观测到{subject}命中请求。",
        "unsupported": "本次未识别到可用入口，请查看下方说明。",
        "standard": "已恢复标准人格。",
    }
    if not result["connected"]:
        summary = "DSH 未连接，请查看下方说明。"
    else:
        summary = summaries.get(phase, "DSH 已连接。")

    discovery = result.get("discovery")
    if discovery:
        source = discovery["module"]
        export = discovery["exportName"]
        method = discovery["methodName"]
        cache = "定位缓存命中，入口已重新核验" if discovery["cacheHit"] else "本次扫描定位"
        discovery_text = f"识别入口：{source}\n导出对象：{export} · 方法：{method} · {cache}"
    else:
        discovery_text = "识别入口：尚无结果"

    applied = result.get("appliedRequests")
    skipped = result.get("skippedRequests")
    applied_text = "尚无统计" if applied is None else f"{applied} 次"
    skipped_text = "尚无统计" if skipped is None else f"{skipped} 次"
    counts = f"实际请求命中：{applied_text}    跳过请求：{skipped_text}"
    reason = result.get("lastSkipReason")
    return StatusText(
        summary=summary,
        discovery=discovery_text,
        requests=counts,
        skipped=f"最近跳过原因：{reason}" if reason else "最近跳过原因：暂无",
    )
