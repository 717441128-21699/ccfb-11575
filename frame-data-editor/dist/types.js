// 核心数据模型:判定框以角色脚底为原点,x 向右(角色朝右时),y 向下。
// 所有框在存储时一律按"朝右"记录,渲染时根据朝向做镜像。
export const totalFrames = (m) => m.startup + m.active + m.recovery;
export function findMove(char, id) {
    const m = char.moves.find((mm) => mm.id === id);
    if (!m)
        throw new Error(`未知招式: ${id}`);
    return m;
}
