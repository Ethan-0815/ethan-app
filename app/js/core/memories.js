/* ESA · 随机回忆（带安全过滤）
 * 允许来源：我的空间普通物品（名称/位置/备注）、旅行足迹旅程（城市/备注）。
 * 禁止来源：ETHAN 的一切数据（含「文本」类）—— 宁可无内容也不做风险判断。
 */
(function (root) {
  'use strict';
  const ESA = (root.ESA = root.ESA || {});

  function pickRandom(list) {
    if (!list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  /** 全量候选：从两个只读源收集 */
  function candidates() {
    return new Promise(function (resolve) {
      const out = [];

      function msDb() {
        return new Promise(function (res) {
          if (!root.indexedDB) return res(null);
          let req;
          try { req = indexedDB.open('my-space'); } catch (e) { return res(null); }
          req.onupgradeneeded = function (ev) {
            if (ev.oldVersion === 0) {
              try { req.result.close(); } catch (e) {}
              try { indexedDB.deleteDatabase('my-space'); } catch (e) {}
              res(null);
            }
          };
          req.onsuccess = function () { res(req.result); };
          req.onerror = function () { res(null); };
        });
      }
      function tfDb() {
        return new Promise(function (res) {
          if (!root.indexedDB) return res(null);
          let req;
          try { req = indexedDB.open('travel-footprint'); } catch (e) { return res(null); }
          req.onupgradeneeded = function (ev) {
            if (ev.oldVersion === 0) {
              try { req.result.close(); } catch (e) {}
              try { indexedDB.deleteDatabase('travel-footprint'); } catch (e) {}
              res(null);
            }
          };
          req.onsuccess = function () { res(req.result); };
          req.onerror = function () { res(null); };
        });
      }
      function getAll(db, store) {
        return new Promise(function (res) {
          try {
            const req = db.transaction(store, 'readonly').objectStore(store).getAll();
            req.onsuccess = function () { res(req.result || []); };
            req.onerror = function () { res([]); };
          } catch (e) { res([]); }
        });
      }

      Promise.all([msDb(), tfDb()]).then(function (dbs) {
        const ms = dbs[0];
        const tf = dbs[1];
        let msP = Promise.resolve();
        let tfP = Promise.resolve();

        if (ms) {
          msP = getAll(ms, 'items').then(function (items) {
            items.filter(function (it) { return it && !it.deletedAt; }).forEach(function (it) {
              const notes = (it.notes || '').trim();
              const loc = (it.location || '').trim();
              if (!notes && !loc) return; // 只挑「值得回看」的：有备注或位置
              out.push({
                source: '我的空间',
                label: '我的空间 · ' + (it.name || '一件物品'),
                text: notes || ('收纳于 ' + loc),
                accent: 'ms'
              });
            });
            ms.close();
          });
        }
        if (tf) {
          tfP = Promise.all([getAll(tf, 'cities'), getAll(tf, 'trips')]).then(function (rs) {
            const byId = {};
            (rs[0] || []).forEach(function (c) { if (c && !c.deletedAt) byId[c.id] = c; });
            (rs[1] || []).filter(function (t) { return t && !t.deletedAt; }).forEach(function (t) {
              const city = byId[t.cityId];
              if (!city) return;
              const note = (t.note || '').trim();
              out.push({
                source: '旅行足迹',
                label: '旅行足迹 · ' + city.name,
                text: note || (t.startDate ? '记录于 ' + t.startDate + ' 的旅程' : ''),
                accent: 'tf'
              });
            });
            tf.close();
          });
        }

        Promise.all([msP, tfP]).then(function () { resolve(out); });
      });
    });
  }

  function randomOne(excludeText) {
    return candidates().then(function (list) {
      if (!list.length) return null;
      let pool = list;
      if (list.length > 1 && excludeText) {
        const filtered = list.filter(function (c) { return c.text !== excludeText; });
        if (filtered.length) pool = filtered;
      }
      return pickRandom(pool);
    });
  }

  ESA.memories = {
    random: randomOne,
    EMPTY_TEXT: '暂时没有值得回看的记录'
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
