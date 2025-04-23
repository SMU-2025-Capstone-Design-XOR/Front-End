// File: src/components/Folder.jsx
import React from 'react';
import PropTypes from 'prop-types';
import '../css/home.css';

/**
 * Folder icon + label component
 */
export const Folder = ({ className, label, onClick, onDoubleClick }) => (
  <div className={`overlap-group ${className || ''}`} onClick={onClick} onDoubleClick={onDoubleClick}>
    <div className="text-wrapper">{label}</div>
  </div>
);
Folder.propTypes = {
  className: PropTypes.string,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func,
  onDoubleClick: PropTypes.func,
};
export default Folder;