(() => {
  "use strict";

  if (window.__xTimelinePhysicsLoaded) return;
  window.__xTimelinePhysicsLoaded = true;

  const Matter = window.Matter;
  const MAX_PIECES = 70;
  const MIN_AREA = 1200;
  const MODE_KEY = "xtp-mode";
  const MODES = {
    TWEETS: "tweets",
    ALL: "all"
  };
  const BODY_OPTIONS = {
    friction: 0.72,
    frictionAir: 0.012,
    restitution: 0.32,
    density: 0.0016,
    render: { visible: false }
  };

  let state = null;
  let mode = localStorage.getItem(MODE_KEY) === MODES.ALL ? MODES.ALL : MODES.TWEETS;

  function installButton() {
    if (document.getElementById("xtp-controls")) return;

    const controls = document.createElement("div");
    controls.id = "xtp-controls";

    const modeButton = document.createElement("button");
    modeButton.id = "xtp-mode";
    modeButton.type = "button";
    modeButton.title = "Switch physics target mode";
    modeButton.addEventListener("click", switchMode);

    const button = document.createElement("button");
    button.id = "xtp-toggle";
    button.type = "button";
    button.title = "Drop timeline posts. Shortcut: Alt+Shift+P";
    button.addEventListener("click", toggle);

    controls.append(modeButton, button);
    document.documentElement.appendChild(controls);
    updateButtons();
  }

  function toggle() {
    if (state) {
      stop();
    } else {
      start();
    }
  }

  function start() {
    if (state || !Matter) return;

    const pieces = collectPieces(mode);
    if (pieces.length === 0) {
      flashButton("No visible posts");
      return;
    }

    document.documentElement.classList.add("xtp-running");

    const stage = document.createElement("canvas");
    stage.id = "xtp-stage";
    stage.width = window.innerWidth;
    stage.height = window.innerHeight;
    document.documentElement.appendChild(stage);

    const layer = document.createElement("div");
    layer.id = "xtp-layer";
    document.documentElement.appendChild(layer);

    const engine = Matter.Engine.create();
    engine.gravity.y = 1.05;

    const render = Matter.Render.create({
      canvas: stage,
      engine,
      options: {
        width: window.innerWidth,
        height: window.innerHeight,
        background: "transparent",
        wireframes: false,
        showAngleIndicator: false
      }
    });
    render.context.clearRect(0, 0, stage.width, stage.height);

    const runner = Matter.Runner.create();
    const bodies = [];
    const records = pieces.map((piece) => {
      const rect = piece.rect;
      const placeholder = document.createElement("div");
      placeholder.className = "xtp-placeholder";
      placeholder.style.width = `${rect.width}px`;
      placeholder.style.height = `${rect.height}px`;

      const original = {
        parent: piece.node.parentNode,
        nextSibling: piece.node.nextSibling,
        style: piece.node.getAttribute("style"),
        className: piece.node.className
      };

      piece.node.parentNode.insertBefore(placeholder, piece.node);

      const wrapper = document.createElement("div");
      wrapper.className = "xtp-piece";
      wrapper.style.left = "0px";
      wrapper.style.top = "0px";
      wrapper.style.width = `${rect.width}px`;
      wrapper.style.height = `${rect.height}px`;
      wrapper.style.setProperty("--xtp-card-bg", getElementBackground(piece.node));
      layer.appendChild(wrapper);

      piece.node.classList.add("xtp-inner");
      wrapper.appendChild(piece.node);

      const body = Matter.Bodies.rectangle(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        rect.width,
        rect.height,
        BODY_OPTIONS
      );
      body.xtpElement = wrapper;
      bodies.push(body);

      return { node: piece.node, wrapper, body, placeholder, original };
    });

    const walls = createWalls();
    Matter.Composite.add(engine.world, [...bodies, ...walls]);

    const mouse = Matter.Mouse.create(stage);
    const mouseConstraint = Matter.MouseConstraint.create(engine, {
      mouse,
      constraint: {
        stiffness: 0.18,
        damping: 0.08,
        render: { visible: false }
      }
    });
    Matter.Composite.add(engine.world, mouseConstraint);
    render.mouse = mouse;

    Matter.Events.on(engine, "afterUpdate", () => syncElements(records));

    window.addEventListener("resize", stop, { once: true });
    document.addEventListener("keydown", onKeydown);

    state = { engine, render, runner, stage, layer, records, mouseConstraint };
    Matter.Render.run(render);
    Matter.Runner.run(runner, engine);
    syncElements(records);
    updateButtons();
  }

  function stop() {
    if (!state) return;

    const current = state;
    state = null;

    window.removeEventListener("resize", stop);
    document.removeEventListener("keydown", onKeydown);

    Matter.Render.stop(current.render);
    Matter.Runner.stop(current.runner);
    Matter.World.clear(current.engine.world, false);
    Matter.Engine.clear(current.engine);
    current.render.canvas.remove();
    current.render.textures = {};

    current.records.forEach((record) => {
      record.node.classList.remove("xtp-inner");
      if (record.original.style === null) {
        record.node.removeAttribute("style");
      } else {
        record.node.setAttribute("style", record.original.style);
      }
      record.node.className = record.original.className;

      if (record.placeholder.parentNode) {
        record.placeholder.parentNode.insertBefore(record.node, record.placeholder);
        record.placeholder.remove();
      } else if (record.original.parent) {
        record.original.parent.insertBefore(record.node, record.original.nextSibling);
      }

      record.wrapper.remove();
    });

    current.layer.remove();
    document.documentElement.classList.remove("xtp-running");
    updateButtons();
  }

  function collectPieces(currentMode) {
    return currentMode === MODES.ALL ? collectAllPieces() : collectTweetPieces();
  }

  function collectTweetPieces() {
    const selectors = [
      'main [data-testid="cellInnerDiv"]',
      'main article[data-testid="tweet"]',
      'main div[aria-label] article'
    ];

    const candidates = [];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        if (node.closest("#xtp-toggle") || node.closest("#xtp-layer")) return;

        const rect = node.getBoundingClientRect();
        if (!isUsableRect(rect)) return;
        addCandidate(candidates, { node, rect });
      });
    });

    return candidates
      .sort((a, b) => a.rect.top - b.rect.top)
      .slice(0, MAX_PIECES);
  }

  function collectAllPieces() {
    const selectors = [
      'main article[data-testid="tweet"]',
      'main [data-testid="cellInnerDiv"]',
      'header nav a',
      'aside a',
      'aside [role="button"]',
      'main a[href]',
      'main [role="button"]',
      'main button',
      'main img',
      'main video',
      '[data-testid="SideNav_AccountSwitcher_Button"]',
      '[data-testid="AppTabBar_Home_Link"]',
      '[data-testid="trend"]',
      '[data-testid="UserCell"]',
      '[aria-label][role="navigation"] a'
    ];

    const candidates = [];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        if (node.closest("#xtp-controls") || node.closest("#xtp-layer")) return;
        if (node === document.body || node === document.documentElement) return;

        const rect = node.getBoundingClientRect();
        if (!isUsableAllRect(rect)) return;
        addCandidate(candidates, { node, rect });
      });
    });

    return candidates
      .sort((a, b) => {
        const areaDelta = b.rect.width * b.rect.height - a.rect.width * a.rect.height;
        if (Math.abs(areaDelta) > 5000) return areaDelta;
        return a.rect.top - b.rect.top;
      })
      .slice(0, MAX_PIECES)
      .sort((a, b) => a.rect.top - b.rect.top);
  }

  function addCandidate(candidates, candidate) {
    const nestedIndex = candidates.findIndex((current) => candidate.node.contains(current.node));
    if (nestedIndex !== -1) {
      candidates.splice(nestedIndex, 1, candidate);
      return;
    }

    if (candidates.some((current) => current.node === candidate.node || current.node.contains(candidate.node))) {
      return;
    }

    candidates.push(candidate);
  }

  function isUsableRect(rect) {
    if (rect.width < 80 || rect.height < 28) return false;
    if (rect.width * rect.height < MIN_AREA) return false;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    if (rect.right < 0 || rect.left > window.innerWidth) return false;
    return true;
  }

  function isUsableAllRect(rect) {
    if (!isUsableRect(rect)) return false;
    if (rect.width > window.innerWidth * 0.92 && rect.height > window.innerHeight * 0.72) return false;
    return true;
  }

  function createWalls() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const t = 120;

    return [
      Matter.Bodies.rectangle(w / 2, h + t / 2, w + t * 2, t, { isStatic: true, render: { visible: false } }),
      Matter.Bodies.rectangle(-t / 2, h / 2, t, h * 3, { isStatic: true, render: { visible: false } }),
      Matter.Bodies.rectangle(w + t / 2, h / 2, t, h * 3, { isStatic: true, render: { visible: false } }),
      Matter.Bodies.rectangle(w / 2, -t / 2, w + t * 2, t, { isStatic: true, render: { visible: false } })
    ];
  }

  function syncElements(records) {
    records.forEach(({ wrapper, body }) => {
      const w = wrapper.offsetWidth;
      const h = wrapper.offsetHeight;
      const x = body.position.x - w / 2;
      const y = body.position.y - h / 2;
      wrapper.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${body.angle}rad)`;
    });
  }

  function getElementBackground(node) {
    const candidates = [
      node,
      node.closest('article[data-testid="tweet"]'),
      node.closest('[data-testid="cellInnerDiv"]'),
      node.closest("main"),
      document.body,
      document.documentElement
    ].filter(Boolean);

    for (const candidate of candidates) {
      let current = candidate;
      while (current && current !== document.documentElement.parentElement) {
        const color = normalizeBackgroundColor(window.getComputedStyle(current).backgroundColor);
        if (color) {
          return color;
        }
        current = current.parentElement;
      }
    }

    const textColor = normalizeBackgroundColor(window.getComputedStyle(document.body).color);
    return isLightText(textColor) ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
  }

  function normalizeBackgroundColor(color) {
    const match = color && color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?\)$/);
    if (!match) return null;

    const alpha = match[4] === undefined ? 1 : Number(match[4]);
    if (alpha < 0.5) return null;

    const rgb = match.slice(1, 4).map(Number);
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  function isLightText(color) {
    const match = color && color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!match) return false;

    const [r, g, b] = match.slice(1).map(Number);
    return (r * 299 + g * 587 + b * 114) / 1000 > 170;
  }

  function switchMode() {
    if (state) return;

    mode = mode === MODES.TWEETS ? MODES.ALL : MODES.TWEETS;
    localStorage.setItem(MODE_KEY, mode);
    updateButtons();
  }

  function updateButtons() {
    const button = document.getElementById("xtp-toggle");
    const modeButton = document.getElementById("xtp-mode");

    if (button) {
      button.classList.toggle("xtp-active", Boolean(state));
      button.textContent = state ? "Reset" : "Drop";
      button.title = state ? "Reset physics" : `Drop ${mode === MODES.ALL ? "all visible elements" : "visible tweets"}`;
    }

    if (modeButton) {
      modeButton.textContent = mode === MODES.ALL ? "Mode: All" : "Mode: Tweets";
      modeButton.disabled = Boolean(state);
    }
  }

  function flashButton(text) {
    const button = document.getElementById("xtp-toggle");
    if (!button) return;

    const previous = button.textContent;
    button.textContent = text;
    window.setTimeout(() => {
      if (!state) button.textContent = previous;
    }, 1200);
  }

  function onKeydown(event) {
    if (event.key === "Escape") stop();
  }

  document.addEventListener("keydown", (event) => {
    if (event.altKey && event.shiftKey && event.code === "KeyP") {
      event.preventDefault();
      toggle();
    }
  });

  const observer = new MutationObserver(installButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  installButton();
})();
