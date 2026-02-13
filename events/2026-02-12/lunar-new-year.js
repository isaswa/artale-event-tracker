/**
 * 春節紅包活動 - Lunar New Year 2026
 * Event period: 2026/02/12 (inclusive) - 2026/03/26 (exclusive, Thursday reset)
 * Last playable day: 2026/03/25
 */
const EVENTS = [
  {
    id: 'lunar-new-year-2026',
    name: '春節紅包活動',
    startDate: '2026-02-12',
    endDate: '2026-03-26', // exclusive
    currency: '紅包',
    tasks: {
      daily: [
        { id: 'lion_battle', name: '吉祥獅獅大作戰', reward: 1, note: '打怪掉落鞭炮後使用', npc: 'GM露露' }
      ],
      weekly: [
        { id: 'horse_soldier', name: '相信木馬士兵吧！', note: '依卡片種類擇一兌換', npc: '加加',
          cardSelect: [
            { card: 3, reward: 1, label: 'Lv.3 卡片' },
            { card: 4, reward: 2, label: 'Lv.4 卡片' },
            { card: 5, reward: 5, label: 'Lv.5 卡片', bonusWeeks: [1, 3, 5], altRewardLabel: '加倍券' }
          ]
        },
        { id: 'reunion_dinner', name: '想吃熱騰騰的團圓飯', reward: 1, note: '收集食材各 10 個', npc: 'GM露露' },
        { id: 'pegasus_shoot', name: '天馬亂射 (小遊戲)', reward: 3, claims: 3, rewardPerClaim: 1, note: '每次1~3個紅包', npc: '維多利亞港npc' },
        { id: 'dodge_centaur', name: '躲避半人馬 (小遊戲)', reward: 3, claims: 3, rewardPerClaim: 1, note: '每次1~3個紅包', npc: 'GM露露', streakBonus: { targetWeeks: 3, reward: 20 } },
        { id: 'horse_first', name: '一馬當先 (小遊戲)', reward: 2, note: '通關即可獲得', npc: '薇薇安' }
      ],
      biweekly: [
        { id: 'team_quest', name: '滿滿春節組隊任務', reward: 3, claims: 3, rewardPerClaim: 1, note: '需組隊完成，含協作憑證獎勵', npc: 'GM露露' }
      ],
      onetime: [
        { id: 'spring_cleaning', name: '迎接春節的大掃除', reward: 10, note: '打怪收集垃圾堆 x30', npc: 'GM露露' },
        { id: 'elder_stan', name: '心繫孩子的長老斯坦', reward: 3, note: '打怪收集年糕 x30', npc: '長老斯坦' }
      ]
    },
    checkin: {
      maxDays: 28,
      milestones: [
        { day: 6, reward: 10 },
        { day: 13, reward: 10 },
        { day: 20, reward: 15 },
        { day: 28, reward: 15 }
      ]
    },
    shop: [
      { id: 'exp_coupon', name: '經驗值2倍券(30分鐘)', cost: 2, maxQty: 10, note: '無法交易' },
      { id: 'drop_coupon', name: '掉落率2倍券(30分鐘)', cost: 2, maxQty: 10, note: '無法交易' },
      { id: 'red_potion', name: '高濃縮紅色藥水×2', cost: 1, maxQty: 15, note: '無法交易' },
      { id: 'blue_potion', name: '高濃縮藍色藥水×2', cost: 1, maxQty: 15, note: '無法交易' },
      { id: 'mystery_bag', name: '神祕背包', cost: 10, maxQty: 1, note: '無法交易' },
      { id: 'horse_chair', name: '我的好友木馬椅', cost: 15, maxQty: 1, note: '每十秒恢復HP/MP 50・無法交易' },
      { id: 'choco_hat', name: '甜蜜巧克力帽', cost: 20, maxQty: 1, note: '無法交易' },
      { id: 'choco_suit', name: '甜蜜巧克力西裝', cost: 20, maxQty: 1, note: '無法交易' },
      { id: 'choco_shoes', name: '甜蜜巧克力皮鞋', cost: 20, maxQty: 1, note: '無法交易' }
    ]
  }
];
