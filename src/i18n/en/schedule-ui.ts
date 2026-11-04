/**
 * 英文字典的「日程 / 提醒」分片：日程页、顶栏入口、提醒弹层与铃声设置。
 * 键 = 界面里的中文原文（与其余分片同一条规矩：同一个键的译法必须一致）。
 */
export default {
  // 顶栏入口与提醒弹层（ScheduleButton）
  '日程': 'Schedule',
  '日程提醒：{0}': 'Schedule reminder: {0}',
  '今天还有 {0} 项日程（悬停查看）': '{0} schedule items left today (hover to view)',
  '日程：悬停查看今天，点开安排': 'Schedule: hover to see today, click to plan',
  '今日日程': "Today's schedule",
  '待办 {0} · 共 {1}': '{0} to do · {1} total',
  '空': 'Empty',
  '今天还没有安排。把要做的事写下来，到点会提醒你。':
    'Nothing planned for today. Write down what you want to do and you will be reminded on time.',
  '还有 {0} 项': '{0} more',
  '手动安排日程': 'Schedule something',
  '日程提醒': 'Schedule reminder',
  '知道了（标记完成）': 'Got it (mark done)',
  '稍后提醒': 'Remind me later',
  '{0} 分钟后': 'In {0} min',
  '打开日程表': 'Open schedule',

  // 日程页（SchedulePage）
  '日程安排': 'Schedule',
  '到点响铃提醒，也可以在顶栏悬停查看今天': 'Rings when due — hover the top bar to see today',
  '前一天': 'Previous day',
  '后一天': 'Next day',
  '回到今天': 'Back to today',
  '今天': 'Today',
  '明天': 'Tomorrow',
  '昨天': 'Yesterday',
  '周日': 'Sunday',
  '周一': 'Monday',
  '周二': 'Tuesday',
  '周三': 'Wednesday',
  '周四': 'Thursday',
  '周五': 'Friday',
  '周六': 'Saturday',
  '待办 {0} · 已完成 {1}': '{0} to do · {1} done',
  '下一项': 'Next up',
  '还有 {0} 项没完成（时间已过）': '{0} still undone (time has passed)',
  '这一天还没有安排': 'Nothing planned for this day',
  '把要做的写下来，到点应用会响铃提醒你。也可以直接让导师帮你排——它有 api.schedule。':
    'Write down what you want to do and the app will ring when it is due. You can also ask the tutor to plan it for you — it has api.schedule.',
  '先写一句「要做什么」': 'Start with what you want to do',
  '时间格式不对，请写成 09:30 这样': 'Invalid time — write it like 09:30',
  '日程已更新': 'Schedule updated',
  '没排上：标题或时间不合法': 'Could not save: title or time is invalid',
  '已安排：{0}': 'Scheduled: {0}',
  '已完成：{0}': 'Done: {0}',
  '已删除：{0}': 'Deleted: {0}',
  '到点时：持续响铃 + 顶栏渐变呼吸，弹出事项让你确认或稍后再提醒。':
    'When due: continuous ring + a breathing glow on the top bar, with a popup to confirm or snooze.',
  '提醒中': 'Ringing',
  '已完成': 'Done',
  '已错过': 'Missed',
  '进行中': 'In progress',
  '稍后提醒过 {0} 次': 'Snoozed {0}×',
  '提前 {0} 分钟提醒': 'Remind {0} min before',
  '准点提醒': 'Remind on time',
  '确认删除': 'Confirm delete',
  '取消': 'Cancel',
  '标记完成': 'Mark done',
  '编辑': 'Edit',
  '删除': 'Delete',
  '编辑日程': 'Edit schedule item',
  '安排一条日程': 'New schedule item',
  '要做什么？（例如：复习夹逼定理）': 'What are you going to do? (e.g. review the squeeze theorem)',
  '日期': 'Date',
  '开始时间': 'Start time',
  '时长': 'Duration',
  '提前提醒': 'Remind before',
  '不设': 'None',
  '{0} 分钟': '{0} min',
  '准点': 'On time',
  '提前 {0} 分钟': '{0} min before',
  '备注（可选）：在哪儿、带什么、为什么约这一场':
    'Note (optional): where, what to bring, why this slot',
  '保存修改': 'Save changes',
  '排进日程': 'Add to schedule',

  // 铃声设置（ScheduleSoundSettings / ReminderPanel）
  '提醒铃声': 'Reminder sound',
  '试听': 'Preview',
  '试听当前铃声': 'Preview current sound',
  '铃声音量': 'Volume',
  '静音': 'Muted',
  '静音（只保留视觉提醒）': 'Muted (visual reminder only)',
  '100%': '100%',
  '风铃': 'Chime',
  '钟声': 'Bell',
  '提示音': 'Beep',
  '柔和': 'Soft',
  '清亮双音，最不容易漏听': 'Bright two-note chime, hardest to miss',
  '悠长有尾音，像老式座钟': 'Long ringing tail, like an old clock',
  '三连短促，隔着房间也听得见': 'Three short beeps, audible across the room',
  '低音慢起，安静环境不惊扰': 'Low and slow, gentle in quiet rooms',
  '日程到点时响铃，同时顶栏会渐变呼吸并弹出事项。铃声由应用现场合成，不需要额外的音频文件。':
    'Rings when a schedule item is due, while the top bar glows and a popup appears. The sound is synthesized live — no audio files involved.',
  '日程到点时用哪一档铃声叫你。提醒本身不会静默跳过——除非把音量拉到 0。':
    'Which sound calls you when a schedule item is due. Reminders are never silently skipped — unless the volume is 0.',
  '跟随当前用户': 'Follows the current user',
  '提醒发生时会怎样': 'What happens when a reminder fires',
  '顶栏整体渐变呼吸，日程按钮上出现脉动小点——即使在别的页签上也看得见。':
    'The whole top bar breathes with a gradient and the schedule button pulses — visible even on another tab.',
  '顶栏弹出这条日程的标题与备注，两颗按钮：知道了（标记完成）或稍后提醒。':
    'A popup shows the title and note, with two actions: Got it (mark done) or remind later.',
  '铃声持续循环，直到你确认或让它隔一阵再提醒；关掉应用不会留下后台响铃。':
    'The sound loops until you confirm or snooze; closing the app leaves no background ringing.',
  '晚到超过 30 分钟的日程不再响铃（避免开机被一堆旧提醒轰炸），但仍会留在日程表里标为已错过。':
    'Items more than 30 minutes late stop ringing (so booting up is not flooded with old reminders) but stay in the list marked as missed.',

  // 设置分页
  '提醒': 'Reminders',
}
