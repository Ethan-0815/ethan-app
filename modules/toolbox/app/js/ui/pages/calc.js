/*!
 * 工具箱 · 计算器
 * 支持 + − × ÷ % ( ) 小数、负数与括号；除以 0 等异常统一给出中文提示。
 * 表达式求值走 TB.calc（不依赖 eval），因此可以直接单元测试。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;
  const ui = TB.ui;
  const F = TB.frame;

  TB.pages.calc = function () {
    const view = F.frame({ title: '计算器' });
    view.footer.classList.add('page__footer--keypad');

    let expr = '';
    let resultText = '';
    let errorText = '';
    let justEvaluated = false;

    const exprEl = ui.h('div', { class: 'calcdisplay__expr calcdisplay__expr--empty', text: '输入算式' });
    const resultEl = ui.h('div', { class: 'calcdisplay__result', text: '0' });

    view.body.appendChild(ui.h('div', { class: 'page__body' }, [
      ui.h('div', { class: 'calcdisplay' }, [exprEl, resultEl]),
      ui.notice('支持括号与百分号：200 × 15% = 30。「±」可以给整个算式加减负号。')
    ]));
    view.body.appendChild(ui.h('div', { class: 'page__spacer' }));

    /* ------------------------------------------------------------ 键盘 */

    const keypad = ui.h('div', { class: 'keypad' });
    TB.calc.KEYPAD.forEach(function (key) {
      const kind = key.kind ? key.kind.split(' ') : [];
      const cls = ['key'];
      if (kind.indexOf('fn') >= 0) cls.push('key--fn');
      if (kind.indexOf('warn') >= 0) cls.push('key--warn');
      if (kind.indexOf('eq') >= 0) cls.push('key--eq');
      if (kind.indexOf('wide') >= 0) cls.push('key--wide');
      keypad.appendChild(ui.h('button', {
        class: cls.join(' '),
        type: 'button',
        dataset: { key: key.id },
        'aria-label': key.label,
        text: key.label,
        onClick: function () { press(key.id); }
      }));
    });
    view.footer.appendChild(keypad);

    /* ------------------------------------------------------------ 逻辑 */

    function refresh(scrollEnd) {
      exprEl.textContent = expr === '' ? '输入算式' : prettyExpr(expr);
      exprEl.classList.toggle('calcdisplay__expr--empty', expr === '');
      if (scrollEnd && exprEl.scrollWidth > 0) exprEl.scrollLeft = exprEl.scrollWidth;

      if (errorText) {
        resultEl.textContent = errorText;
        resultEl.className = 'calcdisplay__result calcdisplay__result--error';
        return;
      }
      if (resultText !== '') {
        resultEl.textContent = resultText;
        resultEl.className = 'calcdisplay__result';
        return;
      }
      if (expr === '') {
        resultEl.textContent = '0';
        resultEl.className = 'calcdisplay__result calcdisplay__result--muted';
        return;
      }
      // 实时预览：只有算得出来才显示，避免边输入边报错
      const preview = TB.calc.evaluate(expr);
      resultEl.textContent = preview.ok ? '= ' + preview.text : '…';
      resultEl.className = 'calcdisplay__result calcdisplay__result--muted';
    }

    /** 把内部运算符显示成用户熟悉的符号 */
    function prettyExpr(text) {
      return text.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
    }

    function press(keyId) {
      if (keyId === 'eq') {
        const r = TB.calc.evaluate(expr);
        if (r.ok) {
          resultText = r.text;
          errorText = '';
          justEvaluated = true;
        } else {
          errorText = r.message;
          resultText = '';
          justEvaluated = false;
        }
        refresh(true);
        return;
      }

      if (justEvaluated) {
        if (/^[0-9]$/.test(keyId) || keyId === 'dot') expr = '';           // 直接开始新算式
        else expr = resultText;                                            // 用结果继续算
        justEvaluated = false;
        resultText = '';
        errorText = '';
      }

      expr = TB.calc.applyKey(expr, keyId);
      refresh(true);
    }

    /* ------------------------------------------------------------ 物理键盘 */

    let keyHandler = null;

    function onKeyDown(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const k = event.key;
      let id = null;
      if (/^[0-9]$/.test(k)) id = k;
      else if (k === '+' || k === '-' || k === '*' || k === '/' || k === '%') id = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'percent' }[k];
      else if (k === 'x' || k === 'X' || k === '×') id = 'mul';
      else if (k === '÷') id = 'div';
      else if (k === '.') id = 'dot';
      else if (k === '(' || k === ')') id = 'paren';
      else if (k === 'Enter' || k === '=') id = 'eq';
      else if (k === 'Backspace') id = 'back';
      else if (k === 'Escape' || k === 'Delete') id = 'clear';
      if (!id) return;
      event.preventDefault();
      press(id);
    }

    return {
      el: view.el,
      onEnter: function () {
        refresh();
        keyHandler = onKeyDown;
        document.addEventListener('keydown', keyHandler);
      },
      onLeave: function () {
        if (keyHandler) document.removeEventListener('keydown', keyHandler);
        keyHandler = null;
      },
      onBack: function () { return false; }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
