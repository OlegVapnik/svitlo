// Ассеты изображений Metro подгружает через require — объявляем тип модуля-числа.
declare module '*.png' {
  const source: number;
  export default source;
}
