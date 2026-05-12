export const genNoMotionStyle = () => {
  return {
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      animation: 'none'
    }
  };
};