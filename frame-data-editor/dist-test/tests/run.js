// 十个已知结果的连段用例,验证 simulateCombo 的判断。
// 运行:npm test
import { createSampleCharacter } from '../src/data.js';
import { simulateCombo } from '../src/combo.js';
const char = createSampleCharacter();
const cases = [
    {
        // 轻拳取消轻拳:接触帧 4 在窗口 4-9 内,5A 在取消表内,命中帧 8 远早于硬直结束 18
        name: '1. 5A → 5A(取消)',
        steps: [{ moveId: '5A', via: 'link' }, { moveId: '5A', via: 'cancel' }],
        firstBlocked: false,
        expectVerdict: 'TRUE_COMBO',
        expectDamage: 60,
    },
    {
        // 经典取消链:轻→中→重→波动,每步接触帧都在窗口内且都在对方硬直结束前命中
        name: '2. 5A → 5B → 5C → 236A(取消链)',
        steps: [
            { moveId: '5A', via: 'link' }, { moveId: '5B', via: 'cancel' },
            { moveId: '5C', via: 'cancel' }, { moveId: '236A', via: 'cancel' },
        ],
        firstBlocked: false,
        expectVerdict: 'TRUE_COMBO',
        expectDamage: 260,
    },
    {
        // 中拳的取消表里没有轻拳 → 非法取消
        name: '3. 5B → 5A(不在取消表)',
        steps: [{ moveId: '5B', via: 'link' }, { moveId: '5A', via: 'cancel' }],
        firstBlocked: false,
        expectVerdict: 'INVALID',
    },
    {
        // 重拳取消窗口是 11-17,第 20 帧才取消 → 窗口已关闭
        name: '4. 5C → 236A(第 20 帧才取消,窗口已过)',
        steps: [{ moveId: '5C', via: 'link' }, { moveId: '236A', via: 'cancel', cancelAt: 20 }],
        firstBlocked: false,
        expectVerdict: 'INVALID',
    },
    {
        // 轻拳 +5,轻拳发生 4:第二招命中帧 18 = 硬直结束帧 18,无缝 → 极限目押成立
        name: '5. 5A → 5A(目押,无缝)',
        steps: [{ moveId: '5A', via: 'link' }, { moveId: '5A', via: 'link' }],
        firstBlocked: false,
        expectVerdict: 'TRUE_COMBO',
        expectGapAt: { step: 1, gap: -1 },
    },
    {
        // 轻拳 +5,中拳发生 7:命中帧 21,对手第 19 帧就恢复了 → 2 帧空档,可防
        name: '6. 5A → 5B(目押,2 帧空档可防)',
        steps: [{ moveId: '5A', via: 'link' }, { moveId: '5B', via: 'link' }],
        firstBlocked: false,
        expectVerdict: 'BLOCKABLE',
        expectGapAt: { step: 1, gap: 2 },
    },
    {
        // 轻拳被防(防硬 10),取消中拳命中帧 11 ≤ 硬直结束 14 → 无缝压制,对手动不了
        name: '7. 5A(被防)→ 5B(取消,无缝压制)',
        steps: [{ moveId: '5A', via: 'link' }, { moveId: '5B', via: 'cancel' }],
        firstBlocked: true,
        expectVerdict: 'TRUE_COMBO',
        expectDamage: 0,
    },
    {
        // 轻拳被防后目押波动:对手第 15 帧恢复,波动第 26 帧才到 → 11 帧空档,能抢升龙
        name: '8. 5A(被防)→ 236A(目押,11 帧空档)',
        steps: [{ moveId: '5A', via: 'link' }, { moveId: '236A', via: 'link' }],
        firstBlocked: true,
        expectVerdict: 'BLOCKABLE',
        expectGapAt: { step: 1, gap: 11 },
    },
    {
        // 重拳取消超杀:取消本身合法(在表内、在窗口内),但超杀发生 24 帧太慢,
        // 对手第 32 帧恢复,超杀第 35 帧才命中 → 3 帧空档,可防
        name: '9. 5C → 236236A(取消合法但超杀太慢)',
        steps: [{ moveId: '5C', via: 'link' }, { moveId: '236236A', via: 'cancel' }],
        firstBlocked: false,
        expectVerdict: 'BLOCKABLE',
        expectGapAt: { step: 1, gap: 3 },
    },
    {
        // 完整取消链收尾用升龙:轻→中→重→升龙,全程无缝
        name: '10. 5A → 5B → 5C → 236B(取消链收尾)',
        steps: [
            { moveId: '5A', via: 'link' }, { moveId: '5B', via: 'cancel' },
            { moveId: '5C', via: 'cancel' }, { moveId: '236B', via: 'cancel' },
        ],
        firstBlocked: false,
        expectVerdict: 'TRUE_COMBO',
        expectDamage: 300,
    },
];
let pass = 0;
let fail = 0;
for (const c of cases) {
    const r = simulateCombo(char, c.steps, c.firstBlocked);
    const errors = [];
    if (r.verdict !== c.expectVerdict) {
        errors.push(`判定 ${r.verdict},应为 ${c.expectVerdict}`);
    }
    if (c.expectGapAt) {
        const s = r.steps[c.expectGapAt.step];
        if (!s || s.gap !== c.expectGapAt.gap) {
            errors.push(`第 ${c.expectGapAt.step} 步空档 ${s?.gap},应为 ${c.expectGapAt.gap}`);
        }
    }
    if (c.expectDamage !== undefined && r.totalDamage !== c.expectDamage) {
        errors.push(`伤害 ${r.totalDamage},应为 ${c.expectDamage}`);
    }
    if (errors.length === 0) {
        pass++;
        console.log(`PASS  ${c.name}  → ${r.verdict},总伤害 ${r.totalDamage}`);
    }
    else {
        fail++;
        console.log(`FAIL  ${c.name}`);
        for (const e of errors)
            console.log(`      ${e}`);
        for (const s of r.steps) {
            console.log(`      [${s.status}] ${s.moveName} 命中帧=${s.hitFrame} 空档=${s.gap} ${s.note}`);
        }
    }
}
console.log(`\n${pass}/10 通过,${fail} 失败`);
if (fail > 0)
    throw new Error(`${fail} 个用例失败`);
