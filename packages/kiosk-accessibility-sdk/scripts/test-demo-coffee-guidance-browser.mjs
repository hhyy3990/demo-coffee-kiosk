import { spawn } from "node:child_process";

const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const viewportWidth = Number(process.env.GUIDANCE_WIDTH || 390);
const viewportHeight = Number(process.env.GUIDANCE_HEIGHT || 844);
const port = 49300 + (process.pid % 500);
const debugPort = port + 500;
const browser = spawn(chromium, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/demo-coffee-guidance-${process.pid}`,
  "about:blank",
], { stdio: "ignore", detached: true });

let socket;
try {
  let target;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`))
        .json()).find((entry) => entry.type === "page");
      if (target) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!target) throw new Error("Chromium did not start.");

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result?.value;
  };
  const readHomeScroll = () => evaluate(`(() => {
    const root = document.querySelector(".kiosk");
    const registered = root?.querySelector('[data-a11y-slot="scroll-content"]');
    const documentScroller = document.scrollingElement;
    const canScroll = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return element.scrollHeight > element.clientHeight + 1 &&
        ["auto", "scroll", "overlay"].includes(style.overflowY);
    };
    const owner = canScroll(registered) ? registered :
      canScroll(documentScroller) ? documentScroller :
      [...(root?.querySelectorAll("*") ?? [])].find(canScroll) ?? null;
    const hint = document.querySelector(".a11y-additional-menu-hint");
    const hintStyle = hint && getComputedStyle(hint);
    const rect = hint?.getBoundingClientRect();
    const ownerRect = owner instanceof Element ? owner.getBoundingClientRect() : null;
    const ownerScaleY = owner instanceof HTMLElement && owner.offsetHeight > 0 && ownerRect
      ? ownerRect.height / owner.offsetHeight : 1;
    const workBottom = ownerRect && owner instanceof HTMLElement
      ? ownerRect.top + (owner.clientTop + owner.clientHeight) * ownerScaleY
      : innerHeight;
    return {
      registered: registered ? {
        tag: registered.tagName, className: registered.className,
        scrollHeight: registered.scrollHeight, clientHeight: registered.clientHeight,
        scrollTop: registered.scrollTop, overflowY: getComputedStyle(registered).overflowY,
      } : null,
      document: documentScroller ? {
        scrollHeight: documentScroller.scrollHeight, clientHeight: documentScroller.clientHeight,
        scrollTop: documentScroller.scrollTop,
      } : null,
      actualOwner: owner ? {
        tag: owner.tagName, className: String(owner.className ?? ""),
        scrollHeight: owner.scrollHeight, clientHeight: owner.clientHeight,
        scrollTop: owner.scrollTop, overflowY: getComputedStyle(owner).overflowY,
      } : null,
      hintVisible: Boolean(hint && hintStyle?.visibility !== "hidden" &&
        hintStyle?.display !== "none" && hint.getAttribute("aria-hidden") !== "true" &&
        rect?.width && rect.height),
      hintRect: rect ? { top: rect.top, bottom: rect.bottom, height: rect.height } : null,
      workBottom,
      hintBottomGap: rect ? workBottom - rect.bottom : null,
      hintText: hint?.textContent?.trim() ?? "",
      hintStyle: hintStyle ? {
        display: hintStyle.display, visibility: hintStyle.visibility,
        opacity: hintStyle.opacity, zIndex: hintStyle.zIndex,
        position: hintStyle.position, pointerEvents: hintStyle.pointerEvents,
      } : null,
      hintHitTargets: (() => {
        if (!hint || !rect?.width || !rect.height) return false;
        const original = hint.style.pointerEvents;
        hint.style.pointerEvents = "auto";
        const visualHit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        hint.style.pointerEvents = original;
        const clickHit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          visuallyOnTop: visualHit === hint || Boolean(visualHit && hint.contains(visualHit)),
          clickPassesThrough: hintStyle.pointerEvents === "none" && clickHit !== hint &&
            Boolean(clickHit && !hint.contains(clickHit)),
          underlyingTag: clickHit?.tagName ?? null,
          underlyingClass: String(clickHit?.className ?? ""),
        };
      })(),
    };
  })()`);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const click = async (selector) => {
    const point = await evaluate(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      target?.scrollIntoView({ block: "center", behavior: "instant" });
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      const panelRect = document.querySelector(".a11y-guide-toast")?.getBoundingClientRect();
      return { x, y, visible: rect.width > 0 && rect.height > 0 &&
        rect.top >= 0 && rect.bottom <= innerHeight, hit: hit === target || target.contains(hit),
        hitElement: hit ? { tag: hit.tagName, id: hit.id, className: String(hit.className) } : null,
        targetRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        panelRect: panelRect ? { left: panelRect.left, top: panelRect.top,
          right: panelRect.right, bottom: panelRect.bottom } : null };
    })()`);
    if (!point?.visible || !point.hit) {
      throw new Error(`Actual hit-test failed for ${selector}: ${JSON.stringify(point)}`);
    }
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: point.x, y: point.y,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
    });
    await wait(120);
  };
  const scrollWelcomeHintCycle = async () => {
    const initial = await readHomeScroll();
    const initialRange = initial.actualOwner
      ? initial.actualOwner.scrollHeight - initial.actualOwner.clientHeight
      : 0;
    if (initialRange <= 1) {
      if (initial.hintVisible) {
        throw new Error(`Welcome hint appeared without a scrollable owner: ${JSON.stringify(initial)}`);
      }
      return { scrollNotNeeded: true, initialOwner: null, hintHiddenWithoutOverflow: true };
    }
    const wheel = async (deltaY) => {
      const point = await evaluate(`(() => {
        const owner = document.querySelector('[data-a11y-slot="scroll-content"]');
        const rect = owner?.getBoundingClientRect();
        return rect ? { x: rect.right - 18, y: rect.top + Math.min(120, rect.height / 2) } : null;
      })()`);
      if (!point) throw new Error("Welcome scroll owner was not found for hint visibility check.");
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY,
      });
      await wait(80);
    };
    await wheel(160);
    const middle = await readHomeScroll();
    for (let index = 0; index < 12; index += 1) await wheel(400);
    await wait(160);
    const bottom = await readHomeScroll();
    await wheel(-160);
    const returned = await readHomeScroll();
    const owner = returned.actualOwner;
    const stablePosition = [middle, bottom, returned].every((sample) =>
      Math.abs((sample.hintRect?.top ?? NaN) - (initial.hintRect?.top ?? NaN)) <= 1,
    );
    const stableAnchor = [initial, middle, bottom, returned].every((sample) =>
      Math.abs((sample.hintBottomGap ?? NaN) - 12) <= 1,
    );
    if (!initial.hintVisible || !middle.hintVisible || !bottom.actualOwner ||
        bottom.actualOwner.scrollTop < bottom.actualOwner.scrollHeight - bottom.actualOwner.clientHeight - 1 ||
        bottom.hintVisible || !returned.hintVisible || !stablePosition || !stableAnchor ||
        !initial.hintHitTargets?.visuallyOnTop || !initial.hintHitTargets?.clickPassesThrough) {
      throw new Error(`Welcome scroll hint did not stay visible, hide only at the end, and return on scroll-up: ${
        JSON.stringify({ initial, middle, bottom, returned, stablePosition })
      }`);
    }
    await evaluate(`document.querySelector('[data-a11y-slot="scroll-content"]').scrollTop = 0`);
    await wait(120);
    return {
      initialOwner: initial.actualOwner,
      middleScrollTop: middle.actualOwner?.scrollTop,
      bottomScrollTop: bottom.actualOwner?.scrollTop,
      returnedScrollTop: owner?.scrollTop,
      hiddenAtBottom: !bottom.hintVisible,
      returnedAfterScrollUp: returned.hintVisible,
      fixedHintPosition: stablePosition,
      anchorGap12px: stableAnchor,
      visibleAboveDock: initial.hintHitTargets.visuallyOnTop,
      clickPassesThrough: initial.hintHitTargets.clickPassesThrough,
    };
  };
  const read = () => evaluate(`(() => {
    const panel = document.querySelector(".a11y-guide-toast");
    if (!panel) return { exists: false, visible: false };
    const rect = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    const primary = [...document.querySelectorAll("[data-a11y-primary='true']")];
    const visibleRect = (element) => {
      const r = element.getBoundingClientRect();
      let left = Math.max(0, r.left), top = Math.max(0, r.top);
      let right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), clip = ancestor.getBoundingClientRect();
        if (["hidden", "clip", "scroll", "auto"].includes(style.overflowX)) {
          left = Math.max(left, clip.left); right = Math.min(right, clip.right);
        }
        if (["hidden", "clip", "scroll", "auto"].includes(style.overflowY)) {
          top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom);
        }
        if (right <= left || bottom <= top) return null;
      }
      return right > left && bottom > top ? { left, top, right, bottom } : null;
    };
    const overlaps = (a, b) => a.left < b.right && a.right > b.left &&
      a.top < b.bottom && a.bottom > b.top;
    const panelVisible = panel.isConnected && style.display !== "none" &&
      style.visibility !== "hidden" && Number(style.opacity) > 0 &&
      rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight;
    const textElement = panel.querySelector("[data-a11y-guide-text]");
    const pageElement = panel.querySelector("[data-a11y-guide-page]");
    const guideControl = [...panel.querySelectorAll("button")].find((button) =>
      !button.hidden && getComputedStyle(button).visibility !== "hidden",
    );
    const guideControlRect = guideControl?.getBoundingClientRect();
    const guideControlHit = Boolean(guideControl && guideControlRect &&
      document.elementFromPoint(
        guideControlRect.left + guideControlRect.width / 2,
        guideControlRect.top + guideControlRect.height / 2,
      )?.closest("button") === guideControl);
    const visiblePrimaryActions = primary.filter((button) => visibleRect(button));
    const primaryActionsHit = visiblePrimaryActions.every((button) => {
      const r = visibleRect(button);
      if (!r) return true;
      const hit = document.elementFromPoint(r.left + (r.right - r.left) / 2, r.top + (r.bottom - r.top) / 2);
      return hit === button || button.contains(hit);
    });
    return {
      exists: panel.isConnected,
      visible: panelVisible,
      panelVisibility: style.visibility,
      panelOpacity: style.opacity,
      hitTest: panelVisible && guideControlHit && primaryActionsHit,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height },
      ariaHidden: panel.getAttribute("aria-hidden"),
      suppressed: panel.dataset.a11yPositionSuppressed === "true",
      title: panel.querySelector("[data-a11y-guide-title]")?.textContent ?? "",
      text: textElement?.textContent ?? "",
      bodyFontSize: textElement ? getComputedStyle(textElement).fontSize : "",
      bodyLineHeight: textElement ? getComputedStyle(textElement).lineHeight : "",
      textVisible: Boolean(textElement && textElement.getClientRects().length &&
        getComputedStyle(textElement).display !== "none" && getComputedStyle(textElement).visibility !== "hidden"),
      page: pageElement?.textContent ?? "",
      pageVisible: Boolean(pageElement && pageElement.getClientRects().length &&
        getComputedStyle(pageElement).display !== "none" && getComputedStyle(pageElement).visibility !== "hidden"),
      pagerHidden: panel.querySelector("[data-a11y-guide-pager]")?.hidden ?? true,
      previousHidden: panel.querySelector("[data-a11y-guide-previous]")?.hidden ?? true,
      nextHidden: panel.querySelector("[data-a11y-guide-next]")?.hidden ?? true,
      countdown: panel.querySelector("[data-a11y-guide-countdown]")?.textContent ?? "",
      collapsed: panel.classList.contains("a11y-guide-collapsed"),
      primaryOverlaps: primary.filter((button) => {
        const r = visibleRect(button);
        return r && overlaps(rect, r);
      })
        .map((button) => button.id || button.textContent?.trim()),
      primaryActions: primary.map((button) => {
        const r = button.getBoundingClientRect();
        const visible = visibleRect(button);
        const x = visible ? visible.left + (visible.right - visible.left) / 2 : 0;
        const y = visible ? visible.top + (visible.bottom - visible.top) / 2 : 0;
        const hit = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight
          ? document.elementFromPoint(x, y) : null;
        return { id: button.id, label: button.textContent?.trim(), top: r.top, bottom: r.bottom,
          centerHit: hit === button || button.contains(hit),
          visibleInViewport: Boolean(visible) };
      }),
      guideControls: ["[data-a11y-guide-collapse]", "[data-a11y-guide-previous]",
        "[data-a11y-guide-next]", ".a11y-guide-close"].map((selector) => {
        const button = panel.querySelector(selector);
        if (!button || button.hidden) return null;
        const r = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const range = document.createRange();
        range.selectNodeContents(button);
        const textRect = range.getBoundingClientRect();
        return { selector, left: r.left, top: r.top, right: r.right, bottom: r.bottom,
          width: r.width, height: r.height, fontSize: style.fontSize, lineHeight: style.lineHeight,
          padding: style.padding, borderWidth: style.borderWidth,
          hitTest: hit === button || button.contains(hit),
          text: button.textContent?.trim() ?? "",
          textVisible: textRect.height > 0 && textRect.left >= r.left - 1 &&
            textRect.right <= r.right + 1 && textRect.top >= r.top - 1 &&
            textRect.bottom <= r.bottom + 1 };
      }).filter(Boolean),
      collapseAccessibleName: panel.querySelector("[data-a11y-guide-collapse]")?.getAttribute("aria-label") ?? "",
      scrollOwner: (() => {
        const el = document.querySelector('[data-a11y-slot="scroll-content"]');
        return el ? { top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom,
          scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
          overflowY: getComputedStyle(el).overflowY } : null;
      })(),
      scrollHint: (() => {
        const hint = document.querySelector(".a11y-additional-menu-hint");
        const hintRect = hint?.getBoundingClientRect();
        const owner = document.querySelector('[data-a11y-slot="scroll-content"]');
        if (!owner) return null;
        const ownerRect = owner.getBoundingClientRect();
        const scaleY = owner.offsetHeight > 0 ? ownerRect.height / owner.offsetHeight : 1;
        const workBottom = ownerRect.top + (owner.clientTop + owner.clientHeight) * scaleY;
        return {
          visible: Boolean(hint && hint.getAttribute("aria-hidden") !== "true" &&
            getComputedStyle(hint).visibility !== "hidden"),
          hintTop: hintRect?.top ?? null,
          hintBottom: hintRect?.bottom ?? null,
          workBottom,
          bottomGap: hintRect ? workBottom - hintRect.bottom : null,
        };
      })(),
    };
  })()`);
  const assertVisible = async (label, expectedTitle) => {
    const state = await read();
    console.log(JSON.stringify({ label, ...state }));
    if (!state.exists || !state.visible || !state.hitTest || state.ariaHidden === "true" ||
      state.suppressed || state.primaryOverlaps.length ||
      (state.scrollHint?.visible && Math.abs(state.scrollHint.bottomGap - 12) > 1) ||
      state.guideControls.some((control) => control.width < 44 ||
        Math.abs(control.height - 44) > 0.1 || !control.hitTest || !control.textVisible) ||
      state.guideControls.some((control, index, controls) => controls.slice(index + 1).some((other) =>
        control.left < other.right && control.right > other.left &&
        control.top < other.bottom && control.bottom > other.top)) ||
      !state.collapseAccessibleName ||
      (expectedTitle && state.title !== expectedTitle)) {
      throw new Error(`${label}: guidance is not visibly and safely presented: ${JSON.stringify(state)}`);
    }
    return state;
  };
  const scrollTenTimes = async (label) => {
    const before = await read();
    for (let index = 0; index < 10; index += 1) {
      const point = await evaluate(`(() => {
        const el = document.querySelector('[data-a11y-slot="scroll-content"]');
        if (!el) return null;
        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        const rect = el.getBoundingClientRect();
        return { x: rect.right - 8, y: Math.min(rect.bottom - 12, rect.top + 50),
          deltaY: el.scrollTop >= max - 2 ? -90 : 90 };
      })()`);
      if (!point) throw new Error(`${label}: scroll owner was not found.`);
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: point.deltaY,
      });
      await wait(75);
      const state = await read();
      if (!state.exists || !state.visible || !state.hitTest || state.ariaHidden !== "false" ||
        state.suppressed || state.primaryOverlaps.length || state.title !== before.title ||
        state.page !== before.page ||
        (state.scrollHint?.visible && Math.abs(state.scrollHint.bottomGap - 12) > 1)) {
        throw new Error(`${label} scroll ${index + 1} hid or obstructed guidance: ${JSON.stringify(state)}`);
      }
    }
    console.log(JSON.stringify({ label, scrolls: 10, after: await read() }));
  };
  const touchScrollOnce = async () => {
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    const point = await evaluate(`(() => {
      const rect = document.querySelector('[data-a11y-slot="scroll-content"]').getBoundingClientRect();
      return { x: rect.right - 12, y: Math.min(rect.bottom - 30, rect.top + 150) };
    })()`);
    const before = await evaluate("document.querySelector('[data-a11y-slot=\"scroll-content\"]').scrollTop");
    const range = await evaluate(`(() => {
      const owner = document.querySelector('[data-a11y-slot="scroll-content"]');
      return owner.scrollHeight - owner.clientHeight;
    })()`);
    if (range <= 1) {
      await send("Emulation.setTouchEmulationEnabled", { enabled: false });
      return { notNeeded: true, scrollRange: range };
    }
    await send("Input.dispatchTouchEvent", {
      type: "touchStart", touchPoints: [{ x: point.x, y: point.y }],
    });
    await send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: point.x, y: point.y - 100 }],
    });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await wait(150);
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    const after = await evaluate("document.querySelector('[data-a11y-slot=\"scroll-content\"]').scrollTop");
    const state = await assertVisible("options-easy-touch-scroll", "핫 · 아이스");
    if (after <= before) {
      throw new Error(`A real touch scroll did not move the app scroll owner: ${before} -> ${after}`);
    }
    return { before, after, guidanceStillVisible: state.visible };
  };
  const waitForGuide = async (label) => {
    const started = performance.now();
    let state;
    for (let attempt = 0; attempt < 115; attempt += 1) {
      state = await read();
      if (state.countdown && state.pagerHidden) break;
      await wait(100);
    }
    const elapsed = performance.now() - started;
    console.log(JSON.stringify({ label, elapsedMs: Math.round(elapsed), ...state }));
    if (!state?.countdown || !state.text || state.page !== "" || !state.pagerHidden ||
      !state.previousHidden || !state.nextHidden || !state.visible || !state.hitTest ||
      state.primaryOverlaps.length) {
      throw new Error(`${label}: Smart Guide state was incorrect: ${JSON.stringify(state)}`);
    }
    return state;
  };
  const waitForEasy = async (label, expectedTitle, expectedPage) => {
    const started = performance.now();
    let state;
    for (let attempt = 0; attempt < 165; attempt += 1) {
      state = await read();
      if (state.title === expectedTitle && state.visible && state.hitTest) break;
      await wait(100);
    }
    const elapsed = performance.now() - started;
    console.log(JSON.stringify({ label, elapsedMs: Math.round(elapsed), ...state }));
    if (state?.title !== expectedTitle || state.page !== expectedPage || !state.visible ||
      !state.hitTest || state.primaryOverlaps.length) {
      throw new Error(`${label}: Easy Language did not resume correctly: ${JSON.stringify(state)}`);
    }
    return state;
  };

  await send("Emulation.setDeviceMetricsOverride", {
    width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: true,
    screenWidth: viewportWidth, screenHeight: viewportHeight,
  });
  await send("Page.navigate", { url: "http://127.0.0.1:5000/" });
  await evaluate(`window.__guidanceLongTasks = [];
    new PerformanceObserver((list) => window.__guidanceLongTasks.push(
      ...list.getEntries().map((entry) => Math.round(entry.duration))
    )).observe({ type: "longtask", buffered: true });`);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    ready = await evaluate("Boolean(document.querySelector('.demo-entry-button'))");
    if (ready) break;
    await wait(50);
  }
  if (!ready) throw new Error("Demo Coffee start screen did not load.");
  const startBeforeProfile = await readHomeScroll();
  await click(".demo-entry-button");
  const firstScreen = await read();
  const startAfterProfile = await readHomeScroll();
  console.log(JSON.stringify({ label: "welcome-scroll-owner", startBeforeProfile, startAfterProfile }));
  const startRange = startAfterProfile.actualOwner
    ? startAfterProfile.actualOwner.scrollHeight - startAfterProfile.actualOwner.clientHeight
    : 0;
  if (startRange > 1 && (!startAfterProfile.hintVisible ||
      !startAfterProfile.hintHitTargets?.visuallyOnTop ||
      !startAfterProfile.hintHitTargets?.clickPassesThrough ||
      Math.abs(startAfterProfile.hintBottomGap - 12) > 1)) {
    throw new Error(`Scrollable welcome screen has no SDK hint: ${JSON.stringify(startAfterProfile)}`);
  }
  if (firstScreen.exists) throw new Error(`Easy Language unexpectedly appeared on the welcome screen: ${JSON.stringify(firstScreen)}`);
  await wait(10_250);
  const smartWelcome = await read();
  const welcomeAfterGuide = await readHomeScroll();
  if (startRange > 1 && (!welcomeAfterGuide.hintVisible ||
      !welcomeAfterGuide.hintHitTargets?.visuallyOnTop ||
      !welcomeAfterGuide.hintHitTargets?.clickPassesThrough ||
      Math.abs(welcomeAfterGuide.hintBottomGap - 12) > 1)) {
    throw new Error(`Smart Guide hid the welcome scroll hint: ${JSON.stringify(welcomeAfterGuide)}`);
  }
  console.log(JSON.stringify({ label: "welcome-after-smart-delay", guideVisible: smartWelcome.visible,
    countdown: smartWelcome.countdown, scroll: welcomeAfterGuide }));
  const welcomeHintCycle = await scrollWelcomeHintCycle();
  console.log(JSON.stringify({ label: "welcome-scroll-hint-cycle", ...welcomeHintCycle }));
  await click("#start-store");
  const menuNavBefore = await evaluate(`(() => {
    const shell = document.querySelector('[data-a11y-slot="scroll-content"]');
    const rail = document.querySelector("#category-nav-list");
    const controls = document.querySelector(".category-nav-controls");
    const verticalRange = shell.scrollHeight - shell.clientHeight;
    const topBefore = controls.getBoundingClientRect().top;
    shell.scrollTop += 140;
    const topAfter = controls.getBoundingClientRect().top;
    const scrollWidth = rail.scrollWidth, clientWidth = rail.clientWidth;
    rail.scrollLeft = scrollWidth;
    const atRight = rail.scrollLeft > 0;
    return { topBefore, topAfter, scrollDelta: topAfter - topBefore, verticalRange,
      scrollWidth, clientWidth, atRight };
  })()`);
  if (viewportWidth < 600 && menuNavBefore.verticalRange > 1 && menuNavBefore.scrollDelta > -20) {
    throw new Error(`Category tabs stayed sticky instead of scrolling with content: ${JSON.stringify(menuNavBefore)}`);
  }
  if (menuNavBefore.scrollWidth > menuNavBefore.clientWidth && !menuNavBefore.atRight) {
    throw new Error(`Category rail did not scroll horizontally: ${JSON.stringify(menuNavBefore)}`);
  }
  await click("#category-nav-list button:nth-child(2)");
  const cakeSelected = await evaluate(`document.querySelector("#category-nav-list button:nth-child(2)")?.getAttribute("aria-pressed")`);
  if (cakeSelected !== "true") throw new Error("Category selection failed after horizontal rail scroll.");
  await click("#category-nav-list button:first-child");
  await evaluate(`document.querySelector('[data-a11y-slot="scroll-content"]').scrollTop = 0;
    document.querySelector("#category-nav-list").scrollLeft = 0;`);
  await click("#menu-product-0");
  await wait(250);
  const optionEasy = await assertVisible("options-entered", "핫 · 아이스");
  if (optionEasy.page !== "1/2") throw new Error(`Options Easy Language did not start at 1/2: ${JSON.stringify(optionEasy)}`);
  await click("[data-a11y-guide-collapse]");
  if (!(await read()).collapsed) throw new Error("Easy Language panel did not fold.");
  await click("[data-a11y-guide-collapse]");
  if ((await read()).collapsed) throw new Error("Easy Language panel did not unfold.");
  await click("[data-a11y-guide-next]");
  if ((await read()).page !== "2/2") throw new Error("Easy Language next-page button did not advance.");
  await click("[data-a11y-guide-previous]");
  if ((await read()).page !== "1/2") throw new Error("Easy Language previous-page button did not return.");
  const touchScroll = await touchScrollOnce();
  await scrollTenTimes("options-easy");
  const optionSmart = await waitForGuide("options-smart-start");
  if (optionSmart.text === optionEasy.text) {
    throw new Error("Easy Language concept copy repeated the Smart Guide action instruction.");
  }
  await scrollTenTimes("options-smart");
  await waitForEasy("options-smart-return", "핫 · 아이스", "1/2");

  await click("#item-add");
  await wait(500);
  if (viewportWidth <= 600) {
    const beforeMenuLayer = await evaluate(`(() => {
      const nav = document.querySelector(".category-nav-controls");
      const cart = document.querySelector(".cart-bar");
      const owner = document.querySelector(".a11y-bottom-viewport-scroll-area") ||
        document.querySelector('[data-a11y-slot="scroll-content"]');
      return { navTop: nav.getBoundingClientRect().top, navPosition: getComputedStyle(nav).position,
        navZ: getComputedStyle(nav).zIndex, cartTop: cart.getBoundingClientRect().top,
        cartPosition: getComputedStyle(cart).position, cartZ: getComputedStyle(cart).zIndex,
        scrollTop: owner.scrollTop };
    })()`);
    const layeredMenu = await evaluate(`(() => {
      const nav = document.querySelector(".category-nav-controls");
      const cart = document.querySelector(".cart-bar");
      const owner = document.querySelector(".a11y-bottom-viewport-scroll-area") ||
        document.querySelector('[data-a11y-slot="scroll-content"]');
      owner.scrollTop += nav.getBoundingClientRect().top - cart.getBoundingClientRect().top;
      const button = document.querySelector("#menu-order-confirm");
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { navTop: nav.getBoundingClientRect().top, cartTop: cart.getBoundingClientRect().top,
        orderButtonHit: hit === button || button.contains(hit) };
    })()`);
    if (beforeMenuLayer.navPosition === "sticky" || beforeMenuLayer.navZ !== "1" ||
      beforeMenuLayer.cartPosition !== "sticky" || Number(beforeMenuLayer.cartZ) <= Number(beforeMenuLayer.navZ) ||
      !layeredMenu.orderButtonHit) {
      throw new Error(`Category rail/order bar stacking regressed: ${JSON.stringify({ beforeMenuLayer, layeredMenu })}`);
    }
  }
  const menuScrollPoint = await evaluate(`(() => {
    const rect = document.querySelector('[data-a11y-slot="scroll-content"]').getBoundingClientRect();
    return { x: rect.right - 8, y: rect.top + 48 };
  })()`);
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel", x: menuScrollPoint.x, y: menuScrollPoint.y, deltaX: 0, deltaY: 360,
  });
  await wait(120);
  await click("#menu-order-confirm");
  await wait(250);
  const cartEasy = await assertVisible("cart-entered", "장바구니");
  if (cartEasy.collapsed) await click("[data-a11y-guide-collapse]");
  await click("[data-a11y-guide-next]");
  const cartPageTwo = await assertVisible("cart-easy-page-two", "수량");
  if (cartPageTwo.page !== "2/2") throw new Error(`Cart explanation could not reach page 2/2: ${JSON.stringify(cartPageTwo)}`);
  await scrollTenTimes("cart-easy");
  await waitForGuide("cart-smart-start");
  await scrollTenTimes("cart-smart");
  const cartReturn = await waitForEasy("cart-smart-return", "수량", "2/2");
  await click("#cart-pay");
  const payment = await assertVisible("payment-entered", "카드와 간편결제");
  if (payment.page !== "1/2") throw new Error(`Payment Easy Language did not start at 1/2: ${JSON.stringify(payment)}`);
  const paymentFirstCopy = "카드는 신용카드나 체크카드로 돈을 내는 방법이에요. 간편결제는 휴대전화에 등록한 결제 수단으로 돈을 내는 방법이에요.";
  if (payment.text !== paymentFirstCopy) {
    throw new Error(`Payment page 1 does not describe card and easy pay: ${payment.text}`);
  }
  const paymentMethods = await evaluate(`Array.from(document.querySelectorAll(".payment-option h3"), (item) => item.textContent.trim())`);
  if (JSON.stringify(paymentMethods) !== JSON.stringify(["카드", "간편 결제", "모바일 쿠폰", "상품권"])) {
    throw new Error(`Payment options changed unexpectedly: ${JSON.stringify(paymentMethods)}`);
  }
  for (let index = 1; index <= paymentMethods.length; index += 1) {
    await evaluate(`document.querySelector(".payment-option:nth-child(${index})").scrollIntoView({ block: "center" })`);
    await wait(100);
    const selector = `.payment-option:nth-child(${index})`;
    await click(selector);
    const selected = await evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute("aria-pressed")`);
    if (selected !== "true") throw new Error(`Payment option ${paymentMethods[index - 1]} was not selectable.`);
  }
  await click("[data-a11y-guide-next]");
  const paymentPageTwo = await assertVisible("payment-page-two", "모바일 쿠폰과 상품권");
  if (paymentPageTwo.page !== "2/2" ||
    paymentPageTwo.text !== "모바일 쿠폰은 휴대전화로 받은 쿠폰을 사용하는 거예요. 상품권은 미리 받은 이용권이나 금액권으로 돈을 내는 방법이에요." ||
    paymentPageTwo.text.includes("영수증")) {
    throw new Error(`Payment page 2 does not match the available methods: ${JSON.stringify(paymentPageTwo)}`);
  }
  await click("#payment-pay");
  let completeReady = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    completeReady = await evaluate("Boolean(document.querySelector('#complete-reset'))");
    if (completeReady) break;
    await wait(100);
  }
  if (!completeReady) throw new Error("The actual demo order did not reach the completion screen.");
  await wait(350);
  const complete = await assertVisible("order-complete", "주문 번호");
  await click(".receipt-actions button");
  await click("#complete-reset");
  let returnedHome = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    returnedHome = await evaluate("Boolean(document.querySelector('.demo-entry-button'))");
    if (returnedHome) break;
    await wait(100);
  }
  if (!returnedHome) throw new Error("The complete demo order did not return to the welcome screen.");
  console.log(JSON.stringify({
    result: "PASS",
    viewport: `${viewportWidth}x${viewportHeight}`,
    firstScreenPanel: firstScreen.exists,
    welcomeScrollOwner: startAfterProfile.actualOwner,
    welcomeHintVisibleBeforeAndAfterSmartGuide: startRange <= 1 ||
      (startAfterProfile.hintVisible && welcomeAfterGuide.hintVisible),
    welcomeHintCycle,
    optionsPanelImmediatelyVisible: optionEasy.visible,
    cartPanelImmediatelyVisible: cartReturn.visible,
    paymentPanelImmediatelyVisible: payment.visible,
    completionPanelImmediatelyVisible: complete.visible,
    fullDemoOrderFinished: returnedHome,
    smartGuidePagerHidden: true,
    tenEasyAndTenSmartWheelScrollsPerStep: true,
    touchScroll,
    longTasksMs: await evaluate("window.__guidanceLongTasks"),
  }, null, 2));
} finally {
  try { socket?.close(); } catch {}
  if (browser.pid) {
    try { process.kill(-browser.pid, "SIGTERM"); } catch { browser.kill("SIGTERM"); }
  }
}
