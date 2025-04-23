// File: src/components/Person.jsx
import React from 'react';
import PropTypes from 'prop-types';
import '../css/home.css';

/**
 * User avatar icon, triggers onContextMenu
 */
export const Person = ({ className, onContextMenu }) => (
  <img className={className} src="/assets/person.svg" alt="User" onContextMenu={onContextMenu} />
);
Person.propTypes = {
  className: PropTypes.string,
  onContextMenu: PropTypes.func,
};
export default Person;