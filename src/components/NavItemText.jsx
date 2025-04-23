// File: src/components/NavItemText.jsx
import React from 'react';
import PropTypes from 'prop-types';
import '../css/home.css';

/**
 * Simple text nav item
 */
export const NavItemText = ({ className, text, onClick }) => (
  <span className={className} onClick={onClick}>{text}</span>
);
NavItemText.propTypes = {
  className: PropTypes.string,
  text: PropTypes.string.isRequired,
  onClick: PropTypes.func,
};
export default NavItemText;
