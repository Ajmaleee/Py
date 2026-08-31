/* ==========================================================================
   PyLogic Bench — Flowchart module
   A small SVG-based drag/drop flowchart builder.
   Exposes window.Flowchart = { init, toDescription, clear, isEmpty }
   ========================================================================== */

(function () {
  const NS = "http://www.w3.org/2000/svg";

  const SHAPE_LABELS = {
    terminal: "Start/End",
    process: "Process",
    io: "Input/Output",
    decision: "Decision",
    loop: "Loop/Predefined",
    connector: "Connector",
  };

  let svg, wrap;
  let nodes = [];   // {id, type, x, y, w, h, text}
  let edges = [];   // {id, from, to}
  let nodeSeq = 1;
  let selectedNodeId = null;
  let dragState = null;      // { id, offsetX, offsetY }
  let linkState = null;      // { fromId, tempLine }

  function uid(prefix) {
    return prefix + (nodeSeq++);
  }

  function ensureDefs() {
    let defs = svg.querySelector("defs");
    if (defs) return;
    defs = document.createElementNS(NS, "defs");
    defs.innerHTML = `
      <marker id="fc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="var(--brass-300)"></path>
      </marker>`;
    svg.appendChild(defs);
  }

  function shapePath(type, w, h) {
    switch (type) {
      case "terminal":
        return `<rect x="0" y="0" width="${w}" height="${h}" rx="${h / 2}" class="fc-node-shape"></rect>`;
      case "decision":
        return `<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}" class="fc-node-shape"></polygon>`;
      case "io":
        return `<polygon points="${h * 0.35},0 ${w},0 ${w - h * 0.35},${h} 0,${h}" class="fc-node-shape"></polygon>`;
      case "loop":
        return `<polygon points="${h * 0.3},0 ${w - h * 0.3},0 ${w},${h / 2} ${w - h * 0.3},${h} ${h * 0.3},${h} 0,${h / 2}" class="fc-node-shape"></polygon>`;
      case "connector":
        return `<circle cx="${w / 2}" cy="${h / 2}" r="${h / 2}" class="fc-node-shape"></circle>`;
      default: // process
        return `<rect x="0" y="0" width="${w}" height="${h}" class="fc-node-shape"></rect>`;
    }
  }

  function defaultSize(type) {
    if (type === "connector") return { w: 46, h: 46 };
    if (type === "decision") return { w: 130, h: 90 };
    return { w: 140, h: 56 };
  }

  function render() {
    svg.innerHTML = "";
    ensureDefs();

    // edges first (under nodes)
    edges.forEach((e) => renderEdge(e));
    nodes.forEach((n) => renderNode(n));
  }

  function nodeCenter(n) {
    return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  }

  function edgeAnchorPoints(a, b) {
    // simple straight line between centers, clipped a bit toward edges
    const ca = nodeCenter(a), cb = nodeCenter(b);
    return { x1: ca.x, y1: ca.y, x2: cb.x, y2: cb.y };
  }

  function renderEdge(e) {
    const a = nodes.find((n) => n.id === e.from);
    const b = nodes.find((n) => n.id === e.to);
    if (!a || !b) return;
    const p = edgeAnchorPoints(a, b);
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", p.x1);
    line.setAttribute("y1", p.y1);
    line.setAttribute("x2", p.x2);
    line.setAttribute("y2", p.y2);
    line.setAttribute("class", "fc-edge");
    line.dataset.edgeId = e.id;
    line.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      edges = edges.filter((x) => x.id !== e.id);
      render();
    });
    svg.appendChild(line);
  }

  function renderNode(n) {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "fc-node" + (n.id === selectedNodeId ? " is-selected" : ""));
    g.setAttribute("transform", `translate(${n.x},${n.y})`);
    g.dataset.nodeId = n.id;
    g.innerHTML = shapePath(n.type, n.w, n.h);

    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", n.w / 2);
    text.setAttribute("y", n.h / 2);
    text.setAttribute("class", "fc-node-text");
    text.textContent = n.text || SHAPE_LABELS[n.type];
    g.appendChild(text);

    // link-out anchor (right edge)
    const anchor = document.createElementNS(NS, "circle");
    anchor.setAttribute("cx", n.w);
    anchor.setAttribute("cy", n.h / 2);
    anchor.setAttribute("r", 6);
    anchor.setAttribute("class", "fc-anchor");
    anchor.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
      startLink(n.id);
    });
    g.appendChild(anchor);

    g.addEventListener("mousedown", (ev) => {
      if (ev.target === anchor) return;
      ev.stopPropagation();
      selectedNodeId = n.id;
      const pt = svgPoint(ev);
      dragState = { id: n.id, offsetX: pt.x - n.x, offsetY: pt.y - n.y };
      render();
    });
    g.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const val = prompt("Label for this box:", n.text || "");
      if (val !== null) {
        n.text = val.trim();
        render();
      }
    });

    svg.appendChild(g);
  }

  function svgPoint(evt) {
    const rect = svg.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left + svg.parentElement.scrollLeft,
      y: evt.clientY - rect.top + svg.parentElement.scrollTop,
    };
  }

  function startLink(fromId) {
    linkState = { fromId };
  }

  function addNode(type, x, y) {
    const size = defaultSize(type);
    const n = {
      id: uid("n"),
      type,
      x: Math.max(0, x - size.w / 2),
      y: Math.max(0, y - size.h / 2),
      w: size.w,
      h: size.h,
      text: "",
    };
    nodes.push(n);
    selectedNodeId = n.id;
    render();
    return n;
  }

  function clear() {
    nodes = [];
    edges = [];
    selectedNodeId = null;
    render();
  }

  function isEmpty() {
    return nodes.length === 0;
  }

  // Convert graph -> readable structured text for the AI prompt
  function toDescription() {
    if (isEmpty()) return "";
    const idIndex = new Map(nodes.map((n, i) => [n.id, i + 1]));
    const lines = ["Flowchart nodes:"];
    nodes.forEach((n) => {
      lines.push(`  [${idIndex.get(n.id)}] (${SHAPE_LABELS[n.type]}) ${n.text || "(untitled)"}`);
    });
    lines.push("Flowchart connections:");
    if (edges.length === 0) lines.push("  (none drawn)");
    edges.forEach((e) => {
      lines.push(`  [${idIndex.get(e.from)}] -> [${idIndex.get(e.to)}]`);
    });
    return lines.join("\n");
  }

  function init(svgEl) {
    svg = svgEl;
    wrap = svg.parentElement;
    render();

    // Drop handling
    wrap.addEventListener("dragover", (ev) => ev.preventDefault());
    wrap.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const type = ev.dataTransfer.getData("text/shape");
      if (!type) return;
      const pt = svgPoint(ev);
      addNode(type, pt.x, pt.y);
    });

    // Palette chips drag start
    document.querySelectorAll(".shape-chip").forEach((chip) => {
      chip.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/shape", chip.dataset.shape);
      });
      // Also support click-to-add (accessibility / no-drag fallback)
      chip.addEventListener("click", () => {
        addNode(chip.dataset.shape, 120, 60 + nodes.length * 70);
      });
    });

    svg.addEventListener("mousemove", (ev) => {
      const pt = svgPoint(ev);
      if (dragState) {
        const n = nodes.find((x) => x.id === dragState.id);
        if (n) {
          n.x = Math.max(0, pt.x - dragState.offsetX);
          n.y = Math.max(0, pt.y - dragState.offsetY);
          render();
        }
      } else if (linkState) {
        // draw temp line
        let temp = svg.querySelector("#fc-temp-line");
        const a = nodes.find((n) => n.id === linkState.fromId);
        if (!a) return;
        const c = nodeCenter(a);
        if (!temp) {
          temp = document.createElementNS(NS, "line");
          temp.id = "fc-temp-line";
          temp.setAttribute("class", "fc-edge");
          temp.setAttribute("stroke-dasharray", "5,4");
          svg.appendChild(temp);
        }
        temp.setAttribute("x1", c.x);
        temp.setAttribute("y1", c.y);
        temp.setAttribute("x2", pt.x);
        temp.setAttribute("y2", pt.y);
      }
    });

    svg.addEventListener("mouseup", (ev) => {
      if (linkState) {
        const target = ev.target.closest(".fc-node");
        if (target && target.dataset.nodeId !== linkState.fromId) {
          edges.push({ id: uid("e"), from: linkState.fromId, to: target.dataset.nodeId });
        }
        linkState = null;
        render();
      }
      dragState = null;
    });

    svg.addEventListener("mousedown", () => {
      selectedNodeId = null;
    });

    document.addEventListener("keydown", (ev) => {
      if ((ev.key === "Delete" || ev.key === "Backspace") && selectedNodeId && document.activeElement === svg) {
        nodes = nodes.filter((n) => n.id !== selectedNodeId);
        edges = edges.filter((e) => e.from !== selectedNodeId && e.to !== selectedNodeId);
        selectedNodeId = null;
        render();
      }
    });
  }

  window.Flowchart = { init, toDescription, clear, isEmpty };
})();
