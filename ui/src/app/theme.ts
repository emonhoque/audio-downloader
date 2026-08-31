import { faMoon, faSun } from "@fortawesome/free-solid-svg-icons";
import { Theme } from "./interfaces/theme";

export const Themes: Theme[] = [
  {
    id: 'light',
    displayName: 'Light',
    icon: faSun,
  },
  {
    id: 'dark',
    displayName: 'Dark',
    icon: faMoon,
  },
];
