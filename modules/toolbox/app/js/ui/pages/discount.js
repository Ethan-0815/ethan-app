/*!
 * 工具箱 · 折扣计算
 * 输入原价与折扣（单位：折），得到折后价格、节省金额与折扣率。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;
  const ui = TB.ui;
  const F = TB.frame;

  TB.pages.discount = function () {
    const view = F.frame({ title: '折扣计算', footer: false });

    const priceInput = ui.textInput({ numeric: true, placeholder: '例如 299', className: 'input--num' });
    const discountInput = ui.textInput({ numeric: true, placeholder: '例如 7.5', className: 'input--num' });
    const priceError = ui.h('div', { class: 'field__error' });
    const discountError = ui.h('div', { class: 'field__error' });
    const resultHost = ui.h('div', {});

    view.body.appendChild(ui.h('div', { class: 'page__body' }, [
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '填写信息' }),
        ui.field('原价', priceInput, null, '元'),
        priceError,
        ui.field('折扣', discountInput, '折：7.5 表示七五折，9 表示九折，10 表示不打折', '折'),
        discountError
      ]),
      resultHost,
      ui.h('div', { class: 'page__spacer' })
    ]));

    function quickChips() {
      const wrap = ui.h('div', { class: 'chiprow', style: { padding: '12px 0 4px' } });
      ['9', '8.5', '8', '7.5', '7', '5'].forEach(function (value) {
        wrap.appendChild(ui.h('button', {
          class: 'chip', type: 'button', text: value + ' 折',
          onClick: function () {
            discountInput.value = value;
            ui.markInvalid(discountInput, false);
            run();
          }
        }));
      });
      return wrap;
    }

    function setError(target, message) {
      if (target === 'price') { priceError.textContent = message || ''; ui.markInvalid(priceInput, !!message); }
      else { discountError.textContent = message || ''; ui.markInvalid(discountInput, !!message); }
    }

    function run() {
      const priceRaw = U.str(priceInput.value).trim();
      const discountRaw = U.str(discountInput.value).trim();
      setError('price', '');
      setError('discount', '');

      if (priceRaw === '' && discountRaw === '') { renderIdle(); return; }
      if (priceRaw === '') { setError('price', '请输入原价'); renderIdle(); return; }
      if (discountRaw === '') { setError('discount', '请填写折扣'); renderIdle(); return; }

      const r = TB.numbers.discount({ price: priceRaw, discount: discountRaw });
      if (!r.ok) {
        if (r.code === 'INVALID_NUMBER') {
          if (U.parseNum(priceRaw) === null) setError('price', r.message);
          else setError('discount', r.message);
        } else {
          toastOnce(r.message);
        }
        renderIdle();
        return;
      }

      ui.clear(resultHost);
      resultHost.appendChild(ui.h('div', { class: 'resultcard', dataset: { result: 'discount' } }, [
        ui.h('div', { class: 'resultcard__label', text: '折后价格' }),
        ui.h('div', { class: 'bignum' }, [
          ui.h('span', { text: U.formatFixed(r.final, 2) }),
          ui.h('span', { class: 'bignum__unit', text: '元' })
        ]),
        ui.h('div', { class: 'rows', style: { marginTop: '14px' } }, [
          ui.rowItem('原价', U.formatFixed(r.price, 2) + ' 元'),
          ui.rowItem('折扣', U.formatNumber(r.discount, 2) + ' 折'),
          ui.rowItem('节省', U.formatFixed(r.saved, 2) + ' 元'),
          ui.rowItem('折扣率', '相当于 ' + U.formatFixed(r.percentOff, 2) + '% 的优惠')
        ]),
        r.higher ? ui.h('div', { style: { marginTop: '12px' } }, [
          ui.notice('折扣大于 10 折，折后价格会比原价更高，请确认输入是否正确。', 'warn')
        ]) : null
      ]));
      F.animateIn(resultHost, { distance: 6 });
    }

    let lastMessage = '';
    function toastOnce(message) {
      if (message === lastMessage) return;
      lastMessage = message;
      ui.toast(message, { tone: 'danger' });
    }

    function renderIdle() {
      ui.clear(resultHost);
      resultHost.appendChild(ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '常用折扣' }),
        quickChips(),
        ui.h('div', { class: 'field__hint', text: '填好原价后，点上面的折扣可以直接算结果。' })
      ]));
    }

    [priceInput, discountInput].forEach(function (input) {
      input.addEventListener('input', ui.debounce(run, 120));
    });

    return {
      el: view.el,
      onEnter: function () { renderIdle(); },
      onBack: function () { return false; }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
