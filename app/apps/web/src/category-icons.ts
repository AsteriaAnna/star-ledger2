const symbols:Record<string,string>={餐饮:'◒',购物:'▢',交通:'↗',生活:'⌂',娱乐:'✧',学习:'▤',医疗:'＋',其他:'⬡',fees:'↗'};
const fallback=['◈','▧','✧','⬡','▣','❖'];
export function categorySymbol(category:string){let hash=0;for(const c of category)hash=(hash*31+c.charCodeAt(0))>>>0;return symbols[category]||fallback[hash%fallback.length];}
