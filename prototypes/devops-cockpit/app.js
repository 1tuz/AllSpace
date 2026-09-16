import { correlate, shortSha } from "./correlation.mjs";

const data = await fetch("./demo-data.json").then((r) => r.json());
const traces = correlate(data);
let selected = traces[0];
const list = document.querySelector("#mission-list");
const detail = document.querySelector("#detail");

function renderList(filter = "") {
  const needle = filter.toLowerCase();
  list.innerHTML = "";
  traces.filter((trace) => JSON.stringify(trace).toLowerCase().includes(needle)).forEach((trace) => {
    const button = document.createElement("button");
    button.className = `mission ${selected.issue.key === trace.issue.key ? "active" : ""}`;
    button.innerHTML = `<span class="severity ${trace.situation.level}"></span><span><b>${trace.issue.key}</b><strong>${trace.issue.summary}</strong><small>${trace.issue.status} · updated ${trace.issue.updated} ago</small></span><em>${trace.situation.label}</em>`;
    button.onclick = () => { selected = trace; renderList(filter); renderDetail(); };
    list.append(button);
  });
}

function node(label, title, meta, tone = "") { return `<div class="trace-node ${tone}"><small>${label}</small><strong>${title}</strong><span>${meta}</span></div>`; }
function renderDetail() {
  const t = selected, pr = t.prs[0], build = t.builds[0], workload = t.deployments[0];
  detail.innerHTML = `<div class="detail-head"><span class="status ${t.situation.level}">${t.situation.label}</span><button>•••</button></div><h2>${t.issue.key}</h2><p>${t.issue.summary}</p><div class="trace">
    ${node("JIRA", t.issue.status, t.issue.assignee)}<i></i>
    ${pr ? node("BITBUCKET PR", `#${pr.id} · ${pr.state}`, `${shortSha(pr.commit)} · ${pr.review}`, pr.state) : node("BITBUCKET", "No pull request", "No correlation") }<i></i>
    ${build ? node("JENKINS", `#${build.number} · ${build.status}`, `${build.job} · ${build.duration}`, build.status) : node("JENKINS", "No build", "No correlation") }<i></i>
    ${workload ? node("KUBERNETES", workload.name, `${workload.cluster}/${workload.namespace} · ${workload.ready}/${workload.desired} ready`, "success") : node("KUBERNETES", "Not deployed", "No matching image or commit")}
  </div><section class="agent"><small>AGENT CONTEXT</small><p>“Where is <b>${t.issue.key}</b> now?”</p><button>Copy trace as context</button><button>Ask in Codex / Cursor</button></section>`;
}

document.querySelector("#work-count").textContent = traces.length;
document.querySelector("#search").addEventListener("input", (event) => renderList(event.target.value));
document.querySelector("#refresh").onclick = (event) => { event.target.textContent = "Synced"; setTimeout(() => event.target.textContent = "Refresh", 900); };
document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key === "k") { event.preventDefault(); document.querySelector("#palette").showModal(); } });
renderList(); renderDetail();
