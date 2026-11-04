/**
 * 网页 guest 进程内的沉浸式双语翻译与选区浮窗 DOM 注入脚本构造器。
 * 纯字符串代码模板，由宿主调用 webview.executeJavaScript 执行。
 */

/** 提取网页中符合条件的未翻译段落块（智能保护内联超链接与按钮，支持独立交互控件） */
export function buildExtractBlocksScript(targetLang = 'zh-CN'): string {
  const safeLang = JSON.stringify(targetLang || 'zh-CN')
  return `(() => {
    try {
      const targetLang = ${safeLang}.toLowerCase();
      const CONTAINER_BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd, figcaption, summary';
      const STANDALONE_INTERACTIVE = 'nav a, header a, footer a, aside a, button';
      const BLOCKS = CONTAINER_BLOCKS + ', ' + STANDALONE_INTERACTIVE;
      const IGNORED = 'script, style, noscript, template, iframe, object, embed, pre, code, kbd, samp, svg, math, .katex, .MathJax, input, textarea, select, [contenteditable], [translate="no"], .notranslate, #unyra-selection-trans-card, .unyra-trans-block';
      
      const elements = Array.from(document.querySelectorAll(BLOCKS));
      const candidates = [];
      let idCounter = 1;

      for (const el of elements) {
        if (el.closest(IGNORED)) continue;
        if (el.getAttribute('data-unyra-translated') === 'true') continue;
        if (el.getAttribute('data-unyra-translating') === 'true') continue;
        if (el.offsetParent === null) continue;

        const tag = el.tagName.toLowerCase();
        // 若独立链接或按钮已经处于段落等容器块内，则跳过（由外层容器通过占位符整体翻译与交互挂载）
        if ((tag === 'a' || tag === 'button') && el.closest(CONTAINER_BLOCKS)) continue;
        // 避免父子容器嵌套重复提取（如 li 内套 p 时只翻 p）
        if (el.matches(CONTAINER_BLOCKS) && el.querySelector(CONTAINER_BLOCKS)) continue;

        // 克隆节点并剔除脚本、样式、预格式化代码等非文本节点，杜绝如 Reddit SML.load 等内部脚本泄露
        const clone = el.cloneNode(true);
        const noiseNodes = Array.from(clone.querySelectorAll('script, style, noscript, template, iframe, object, embed, svg, math, pre, code'));
        for (const n of noiseNodes) {
          n.remove();
        }

        // 若块内包含有效的内联超链接或按钮，构造带占位符的克隆文本，实现精准语境保护
        const activeLinks = Array.from(el.querySelectorAll('a[href]')).filter((a) => {
          return !a.closest(IGNORED) && (a.innerText || a.textContent || '').trim().length > 0;
        });
        const activeButtons = Array.from(el.querySelectorAll('button')).filter((b) => {
          return !b.closest(IGNORED) && (b.innerText || b.textContent || '').trim().length > 0;
        });

        if (activeLinks.length > 0 || activeButtons.length > 0) {
          const cloneLinks = Array.from(clone.querySelectorAll('a[href]')).filter((a) => {
            return (a.innerText || a.textContent || '').trim().length > 0;
          });
          cloneLinks.forEach((a, i) => {
            const inner = (a.innerText || a.textContent || '').trim();
            a.replaceWith(document.createTextNode('[a' + i + ']' + inner + '[/a' + i + ']'));
          });
          const cloneButtons = Array.from(clone.querySelectorAll('button')).filter((b) => {
            return (b.innerText || b.textContent || '').trim().length > 0;
          });
          cloneButtons.forEach((b, i) => {
            const inner = (b.innerText || b.textContent || '').trim();
            b.replaceWith(document.createTextNode('[b' + i + ']' + inner + '[/b' + i + ']'));
          });
        }

        let text = clone.innerText ? clone.innerText.trim() : (clone.textContent ? clone.textContent.trim() : '');
        // 清理残存的脚本模式匹配（如内联即时执行函数、Shreddit 模块加载调用等）
        text = text
          .replace(/\\(\\s*\\(\\s*\\)\\s*=>\\s*\\{[\\s\\S]*?\\}\\s*\\)\\s*\\(\\s*\\);?/g, '')
          .replace(/SML\\.load\\([\\s\\S]*?\\);?/g, '')
          .trim();

        if (text.length < 2 || text.length > 5000) continue;

        // 根据目标语言智能过滤：如果原文已经属于目标语言，则跳过
        if (targetLang.startsWith('zh')) {
          // 目标语言是中文：中文字符数占全文本比重超 35% 说明原本就是中文
          const chineseMatches = text.match(/[\\u4e00-\\u9fa5]/g);
          const chineseCount = chineseMatches ? chineseMatches.length : 0;
          if (chineseCount / text.length > 0.35) continue;
          // 必须含有外文词汇
          if (!/[a-zA-Z]{2,}|[\\u3040-\\u30ff]|[\\uac00-\\ud7af]/.test(text)) continue;
        } else if (targetLang.startsWith('en')) {
          // 目标语言是英文：如果纯 ASCII/英文且不含非英文字符，则原本就是英文
          const nonAsciiMatches = text.match(/[^\\x00-\\x7F]/g);
          const nonAsciiCount = nonAsciiMatches ? nonAsciiMatches.length : 0;
          if (nonAsciiCount / text.length < 0.15 && /[a-zA-Z]{2,}/.test(text)) continue;
        }

        let uid = el.getAttribute('data-unyra-id');
        if (!uid) {
          uid = 'ut-' + Date.now().toString(36) + '-' + (idCounter++);
          el.setAttribute('data-unyra-id', uid);
        }

        // 立即标记为正在派发翻译中，使得后续 DOM 变动与滚动扫描能立刻独立跳过它，彻底摆脱串行锁
        el.setAttribute('data-unyra-translating', 'true');

        candidates.push({ id: uid, text });
      }

      return { ok: true, candidates };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })()`
}

/** 注入段落译文（还原内联超链接/按钮交互能力，支持点击事件透传与兜底芯片） */
export function buildInsertTranslationsScript(items: Array<{ id: string; translation: string }>): string {
  const json = JSON.stringify(items)
  return `(() => {
    try {
      const items = ${json};
      for (const item of items) {
        const el = document.querySelector('[data-unyra-id="' + item.id + '"]');
        if (!el || !el.parentNode) continue;

        const isTranslated =
          el.getAttribute('data-unyra-translated') === 'true' ||
          !!document.querySelector('[data-unyra-for="' + item.id + '"]');
        if (isTranslated) {
          el.removeAttribute('data-unyra-translating');
          continue;
        }

        el.setAttribute('data-unyra-translated', 'true');
        el.removeAttribute('data-unyra-translating');

        // 克隆原元素（浅克隆，保留原标签、类名、行内样式、字体与排版特征）
        const transEl = el.cloneNode(false);
        transEl.removeAttribute('id');
        transEl.removeAttribute('data-unyra-id');
        transEl.removeAttribute('data-unyra-translating');
        transEl.setAttribute('data-unyra-for', item.id);
        transEl.setAttribute('data-unyra-trans', 'true');
        transEl.classList.add('unyra-trans-block');
        transEl.classList.add('notranslate');

        // 若原元素是 li 列表项，去除重复项目符号/序号，保持为原生 li 紧随排版
        if (el.tagName.toLowerCase() === 'li') {
          transEl.style.listStyleType = 'none';
          transEl.style.listStyle = 'none';
        }

        // 微调间距与沉浸感对比度（保持原字号、原色调、原字体，仅留舒适的对比透明度）
        transEl.style.marginTop = '4px';
        transEl.style.opacity = '0.88';
        transEl.style.transition = 'opacity 0.2s ease';

        const tag = el.tagName.toLowerCase();
        const isSelfLink = tag === 'a';
        const isSelfButton = tag === 'button';

        // 独立控件处理：若原节点本身就是 <a> 或 <button>，继承目标与属性并透传原生/框架点击事件
        if (isSelfLink) {
          const origHref = el.getAttribute('href');
          if (origHref) transEl.setAttribute('href', origHref);
          const origTarget = el.getAttribute('target');
          if (origTarget) transEl.setAttribute('target', origTarget);
          transEl.style.cursor = 'pointer';
          transEl.addEventListener('click', (e) => {
            e.preventDefault();
            el.click();
          });
        } else if (isSelfButton) {
          transEl.style.cursor = 'pointer';
          transEl.addEventListener('click', (e) => {
            e.preventDefault();
            el.click();
          });
        }

        // 检索原元素中的活动超链接与按钮
        const childLinks = Array.from(el.querySelectorAll('a[href]')).filter((a) => {
          return (a.innerText || a.textContent || '').trim().length > 0;
        });
        const childButtons = Array.from(el.querySelectorAll('button')).filter((b) => {
          return (b.innerText || b.textContent || '').trim().length > 0;
        });
        const hasInteractive = childLinks.length > 0 || childButtons.length > 0;

        if (!hasInteractive) {
          transEl.textContent = item.translation;
        } else {
          // 解析占位符：支持 [a0]...[/a0] / [b0]...[/b0] 以及 <a0>...</a0> / <b0>...</b0>
          const markerRegex = /\\[([ab])(\\d+)\\]([\\s\\S]*?)\\[\\/\\1\\2\\]|<([ab])(\\d+)>([\\s\\S]*?)<\\/\\4\\5>/gi;
          let lastIdx = 0;
          let match;
          let markerCount = 0;

          while ((match = markerRegex.exec(item.translation)) !== null) {
            markerCount++;
            if (match.index > lastIdx) {
              transEl.appendChild(document.createTextNode(item.translation.slice(lastIdx, match.index)));
            }
            lastIdx = markerRegex.lastIndex;

            const tagType = (match[1] || match[4] || '').toLowerCase();
            const tagIdx = parseInt(match[2] || match[5], 10);
            const tagText = match[3] || match[6] || '';

            if (tagType === 'a' && tagIdx < childLinks.length) {
              const origLink = childLinks[tagIdx];
              const newLink = origLink.cloneNode(false);
              newLink.removeAttribute('id');
              newLink.removeAttribute('data-unyra-id');
              newLink.textContent = tagText;
              const href = origLink.getAttribute('href');
              if (href) newLink.setAttribute('href', href);
              const target = origLink.getAttribute('target');
              if (target) newLink.setAttribute('target', target);
              newLink.style.cursor = 'pointer';
              newLink.addEventListener('click', (e) => {
                e.preventDefault();
                origLink.click();
              });
              transEl.appendChild(newLink);
            } else if (tagType === 'b' && tagIdx < childButtons.length) {
              const origBtn = childButtons[tagIdx];
              const newBtn = origBtn.cloneNode(false);
              newBtn.removeAttribute('id');
              newBtn.removeAttribute('data-unyra-id');
              newBtn.textContent = tagText;
              newBtn.style.cursor = 'pointer';
              newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                origBtn.click();
              });
              transEl.appendChild(newBtn);
            } else {
              transEl.appendChild(document.createTextNode(tagText));
            }
          }

          if (lastIdx < item.translation.length) {
            transEl.appendChild(document.createTextNode(item.translation.slice(lastIdx)));
          }

          // 容错兜底：若机翻引擎删除了标签占位符（markerCount === 0），以交互链接芯片形式追加在段末，绝不遗漏链接
          if (markerCount === 0 && childLinks.length > 0) {
            const tray = document.createElement('span');
            tray.className = 'unyra-trans-links-tray';
            tray.style.cssText = 'display:inline-flex;flex-wrap:wrap;gap:6px;margin-left:6px;vertical-align:baseline;font-size:0.9em;';
            for (const origLink of childLinks) {
              const chip = origLink.cloneNode(false);
              chip.className = 'unyra-trans-link-chip';
              chip.removeAttribute('id');
              chip.removeAttribute('data-unyra-id');
              const href = origLink.getAttribute('href');
              if (href) chip.setAttribute('href', href);
              const target = origLink.getAttribute('target');
              if (target) chip.setAttribute('target', target);
              chip.textContent = '🔗 ' + (origLink.innerText || origLink.textContent || 'Link').trim();
              chip.style.cssText = 'color:#6366f1;text-decoration:underline;cursor:pointer;opacity:0.9;';
              chip.addEventListener('click', (e) => {
                e.preventDefault();
                origLink.click();
              });
              tray.appendChild(chip);
            }
            transEl.appendChild(tray);
          }
        }

        if (el.nextSibling) {
          el.parentNode.insertBefore(transEl, el.nextSibling);
        } else {
          el.parentNode.appendChild(transEl);
        }
      }
      return { ok: true, count: items.length };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })()`
}

/** 切换双语译文的显示与隐藏 */
export function buildToggleTranslationsScript(): string {
  return `(() => {
    let style = document.getElementById('unyra-trans-toggle-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'unyra-trans-toggle-style';
      document.head.appendChild(style);
    }
    if (style.textContent.includes('none')) {
      style.textContent = '';
      return 'visible';
    } else {
      style.textContent = '.unyra-trans-block { display: none !important; }';
      return 'hidden';
    }
  })()`
}

/** 当翻译请求失败或译文无效时，解除待翻译元素的 data-unyra-translating 锁定，允许后续重试 */
export function buildUnmarkTranslatingScript(ids: string[]): string {
  const json = JSON.stringify(ids)
  return `(() => {
    try {
      const ids = ${json};
      for (const id of ids) {
        const el = document.querySelector('[data-unyra-id="' + id + '"]');
        if (el) {
          el.removeAttribute('data-unyra-translating');
        }
      }
    } catch {}
  })()`
}

/** 清除页面中所有已注入的双语译文并停止动态监听 */
export function buildClearTranslationsScript(): string {
  return `(() => {
    if (window.__unyraObserver) {
      window.__unyraObserver.disconnect();
      window.__unyraObserver = null;
    }
    if (window.__unyraObserverTimer) {
      clearTimeout(window.__unyraObserverTimer);
      window.__unyraObserverTimer = null;
    }
    const blocks = document.querySelectorAll('.unyra-trans-block');
    blocks.forEach((b) => b.remove());
    const originEls = document.querySelectorAll('[data-unyra-translated], [data-unyra-translating]');
    originEls.forEach((el) => {
      el.removeAttribute('data-unyra-translated');
      el.removeAttribute('data-unyra-translating');
      el.removeAttribute('data-unyra-id');
    });
    const style = document.getElementById('unyra-trans-toggle-style');
    if (style) style.remove();
    return blocks.length;
  })()`
}

/** 启动页面 DOM 动态变化监听（SPA / 滚动加载 / 异步注入内容时自动通知宿主继续翻译） */
export function buildStartDomObserverScript(): string {
  return `(() => {
    try {
      if (window.__unyraObserver) {
        window.__unyraObserver.disconnect();
        window.__unyraObserver = null;
      }
      if (window.__unyraObserverTimer) {
        clearTimeout(window.__unyraObserverTimer);
        window.__unyraObserverTimer = null;
      }

      const observer = new MutationObserver((mutations) => {
        let hasRelevant = false;
        for (const m of mutations) {
          if (m.addedNodes && m.addedNodes.length > 0) {
            for (let i = 0; i < m.addedNodes.length; i++) {
              const node = m.addedNodes[i];
              if (node.nodeType === 1) {
                const el = node;
                if (el.classList && el.classList.contains('unyra-trans-block')) continue;
                if (el.getAttribute && el.getAttribute('data-unyra-trans')) continue;
                if (el.id === 'unyra-trans-toggle-style' || el.id === 'unyra-selection-trans-card') continue;
                hasRelevant = true;
                break;
              }
            }
          }
          if (hasRelevant) break;
        }

        if (!hasRelevant) return;

        if (window.__unyraObserverTimer) {
          clearTimeout(window.__unyraObserverTimer);
        }
        window.__unyraObserverTimer = setTimeout(() => {
          console.log('__UNYRA_PAGE_MUTATION__');
        }, 400);
      });

      observer.observe(document.body, { childList: true, subtree: true });
      window.__unyraObserver = observer;
      return { ok: true, observing: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })()`
}

/** 停止页面 DOM 动态变化监听 */
export function buildStopDomObserverScript(): string {
  return `(() => {
    try {
      if (window.__unyraObserverTimer) {
        clearTimeout(window.__unyraObserverTimer);
        window.__unyraObserverTimer = null;
      }
      if (window.__unyraObserver) {
        window.__unyraObserver.disconnect();
        window.__unyraObserver = null;
        return { ok: true, stopped: true };
      }
      return { ok: true, stopped: false };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })()`
}

/** 弹出选中文本的翻译卡片浮层 */
export function buildSelectionPopupScript(payload: {
  original: string
  translation: string
  engine: 'fast' | 'ai'
  x: number
  y: number
}): string {
  const safeTranslation = payload.translation
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const safePayload = {
    ...payload,
    translation: safeTranslation,
  }
  const json = JSON.stringify(safePayload)
  return `(() => {
    const p = ${json};
    const old = document.getElementById('unyra-selection-trans-card');
    if (old) old.remove();

    const card = document.createElement('div');
    card.id = 'unyra-selection-trans-card';
    const posX = Math.min(Math.max(16, p.x), window.innerWidth - 360);
    const posY = Math.min(Math.max(16, p.y + 12), window.innerHeight - 240);

    card.style.cssText = [
      'position: fixed',
      'z-index: 2147483647',
      'left: ' + posX + 'px',
      'top: ' + posY + 'px',
      'width: 340px',
      'max-width: calc(100vw - 32px)',
      'background: #ffffff',
      'color: #0f172a',
      'border: 1px solid rgba(148, 163, 184, 0.4)',
      'box-shadow: 0 12px 28px -4px rgba(0, 0, 0, 0.18), 0 8px 12px -6px rgba(0, 0, 0, 0.12)',
      'border-radius: 12px',
      'padding: 12px 14px',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'font-size: 13px',
      'line-height: 1.55',
      'box-sizing: border-box',
    ].join(';');

    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) {
      card.style.background = '#1e293b';
      card.style.color = '#f1f5f9';
      card.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      card.style.boxShadow = '0 12px 28px -4px rgba(0, 0, 0, 0.6)';
    }

    const engineLabel = p.engine === 'ai' ? '🤖 AI 深度翻译' : '⚡ 极速翻译';
    card.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(148,163,184,0.2);">',
      '  <span style="font-size:11px;font-weight:600;color:#6366f1;background:rgba(99,102,241,0.1);padding:2px 6px;border-radius:4px;">' + engineLabel + '</span>',
      '  <button id="unyra-trans-close-btn" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;padding:0 4px;">&times;</button>',
      '</div>',
      '<div id="unyra-trans-text-box" style="max-height:160px;overflow-y:auto;margin-bottom:10px;font-size:13px;line-height:1.6;word-break:break-word;user-select:text;">',
      '  ' + p.translation,
      '</div>',
      '<div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;">',
      '  <button id="unyra-trans-copy-btn" style="background:rgba(148,163,184,0.15);border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;color:inherit;">复制译文</button>',
      '</div>',
    ].join('');

    card.querySelector('#unyra-trans-close-btn').onclick = () => card.remove();
    card.querySelector('#unyra-trans-copy-btn').onclick = (e) => {
      const btn = e.currentTarget;
      navigator.clipboard.writeText(p.translation).then(() => {
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = '复制译文'; }, 1500);
      });
    };

    document.body.appendChild(card);

    const onDown = (e) => {
      if (!card.contains(e.target)) {
        card.remove();
        document.removeEventListener('mousedown', onDown);
      }
    };
    setTimeout(() => {
      document.addEventListener('mousedown', onDown);
    }, 100);
  })()`
}
