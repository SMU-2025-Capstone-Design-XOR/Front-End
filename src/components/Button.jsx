import React from 'react';
import PropTypes from 'prop-types';
import '../css/login.css';

export const Button = ({ text, onClick, type = 'button', className = '' }) => {
  return (
    <button
      className={`button-instance ${className}`}
      onClick={onClick}
      type={type}
    >
      {text}
    </button>
  );
};

Button.propTypes = {
  text: PropTypes.string.isRequired,
  onClick: PropTypes.func,
  type: PropTypes.oneOf(['button', 'submit']),
  className: PropTypes.string,
};

export default Button;